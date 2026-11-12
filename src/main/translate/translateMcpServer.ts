/**
 * In-process MCP server for free machine translation: a piece of text, or a whole subtitle file by
 * its path, so the lines never pass through the model. Takes the translator and the file operations
 * as parameters; the real ones are in translateConnection.ts.
 *
 * This connector is on by default, so it carries no connector notes: they sit in every turn of every
 * run. What the model must know before calling is in each description's first sentence, the part the
 * catalog shows (130 characters); the rest is there for `tool_help`.
 */
import * as path from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, createToolServer, type ToolServer } from '../mcp/inProcessServer';
import { ALSO_NAMED } from '../mcp/schemaAliases';
import { engineLanguage, type EngineLanguage } from './engineLanguages';
import { SUBTITLE_EXTENSIONS, decodeSubtitle, parseSubtitle, renderSubtitle, subtitleKind } from './subtitleDocument';
import { TranslateFailure, type TranslateInput, type TranslateOutput, type Translator } from './translateService';

export const TRANSLATE_SERVER_NAME = 'Free Translate';

export interface TranslateMcpDeps {
  translate: Translator;
  fileSize: (file: string) => Promise<number>;
  readFile: (file: string) => Promise<Uint8Array>;
  /** Stores a new file and returns the name the agent can read it back by. */
  saveOutput: (fileName: string, content: string) => Promise<string>;
}

/**
 * Sized against the /agent observation caps: the translation comes back through the model, and a
 * BYOK observation is cut at 16,000 characters. A translation into a Latin script runs longer than
 * its Chinese source, so this leaves room for that.
 */
const TEXT_MAX_CHARS = 10_000;
const SUBTITLE_MAX_BYTES = 5 * 1024 * 1024;
/** About twenty hours of dialogue; more than this is not one subtitle file. */
const SUBTITLE_MAX_LINES = 20_000;
const BOM = '﻿';

/** Every result says what it is, so a reply does not hand a context-free draft over as finished. */
export const MT_NOTE = 'Machine translation, line by line with no context: names, slang and wordplay can come out wrong. Tell the user it is a quick draft.';

/*
 * Both are reads to the action gate, translate_subtitle included: it only adds a new file under a
 * fresh name in the output folder, as file_write may without asking, and this connector is on by
 * default, so a change tool here would make every run on every computer carry the change rules.
 */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

const TO = { type: 'string', description: 'Target language: zh-TW, zh-CN, en, ja, ko…', [ALSO_NAMED]: ['target', 'target_language', 'target_lang', 'language', 'lang'] };
const FROM = { type: 'string', description: 'Source language; blank = detect', [ALSO_NAMED]: ['source', 'source_language', 'source_lang'] };

export const TRANSLATE_TOOLS: Tool[] = [
  {
    name: 'translate_text',
    description: `Free Microsoft machine translation (text leaves this PC), for long text or on request; translate short passages yourself. It has no sense of the surrounding lines, so names, tone and jokes can come out wrong; do not send private text unless the user asked. Up to ${TEXT_MAX_CHARS} characters.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text; each line is translated on its own', [ALSO_NAMED]: ['content', 'input', 'source_text', 'lines'] },
        to: TO,
        from: FROM,
      },
      required: ['text', 'to'],
    },
    annotations: { title: 'Translate text', idempotentHint: true, ...READ_ONLY },
  },
  {
    name: 'translate_subtitle',
    description: `Translate a subtitle file by path with free Microsoft machine translation (text leaves this PC); never paste its lines. Takes ${SUBTITLE_EXTENSIONS.join(' ')}; keeps every time code, saves a new file in the output folder and returns its name for you to tell the user.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file, in the output folder, Documents, Downloads or Desktop', [ALSO_NAMED]: ['file', 'file_path', 'filename', 'subtitle'] },
        to: TO,
        from: FROM,
        bilingual: { type: 'boolean', description: 'true = keep the original under each translation' },
      },
      required: ['path', 'to'],
    },
    annotations: { title: 'Translate a subtitle file', idempotentHint: false, ...READ_ONLY },
  },
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required argument: ${field}`);
  return value;
}

function languageArg(value: unknown, field: string): EngineLanguage {
  const language = engineLanguage(requireString(value, field));
  if (language) return language;
  throw new ToolError('invalid_language', `"${String(value).slice(0, 40)}" is not a language code. Use one such as zh-TW, zh-CN, en, ja or ko.`);
}

function sourceArg(value: unknown): EngineLanguage | null {
  return typeof value === 'string' && value.trim() ? languageArg(value, 'from') : null;
}

function requestOf(args: Record<string, unknown>, lines: readonly string[], signal: AbortSignal): TranslateInput {
  return { lines, to: languageArg(args.to, 'to'), from: sourceArg(args.from), signal };
}

async function run(deps: TranslateMcpDeps, input: TranslateInput): Promise<TranslateOutput> {
  try {
    return await deps.translate(input);
  } catch (err) {
    if (!(err instanceof TranslateFailure)) throw err;
    throw new ToolError('translate_failed', err.message, { translated: err.done, total: err.total });
  }
}

async function translateText(deps: TranslateMcpDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const text = requireString(args.text, 'text');
  if (text.length > TEXT_MAX_CHARS) {
    throw new ToolError('too_long', `${text.length} characters is over the ${TEXT_MAX_CHARS} one call takes. Split the text and send the parts in turn.`);
  }
  const input = requestOf(args, text.split(/\r?\n/), signal);
  const result = await run(deps, input);
  return { translation: result.lines.join('\n'), to: input.to.tag, note: MT_NOTE };
}

/** The file's bytes. Errors name the file only: the path here is resolved and carries the account name. */
async function subtitleBytes(deps: TranslateMcpDeps, file: string): Promise<Uint8Array> {
  const name = path.basename(file);
  try {
    if (await deps.fileSize(file) > SUBTITLE_MAX_BYTES) throw new ToolError('too_large', `"${name}" is over ${SUBTITLE_MAX_BYTES / 1024 / 1024} MB, too large to be one subtitle file.`);
    return await deps.readFile(file);
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError('file_not_found', `"${name}" could not be read. Tell the user it was not found; never translate a different file in its place.`);
  }
}

async function translateSubtitle(deps: TranslateMcpDeps, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const file = requireString(args.path, 'path').trim();
  const kind = subtitleKind(file);
  if (!kind) throw new ToolError('unsupported_file', `Not a subtitle file. These work: ${SUBTITLE_EXTENSIONS.join(', ')}.`);
  const text = decodeSubtitle(await subtitleBytes(deps, file));
  if (text === null) throw new ToolError('unsupported_encoding', 'The file is not UTF-8 or UTF-16. Ask the user to save it as UTF-8 and try again.');
  const doc = parseSubtitle(kind, text);
  if (doc.spans.length === 0) throw new ToolError('no_subtitles', 'No subtitle lines were found in this file.');
  if (doc.spans.length > SUBTITLE_MAX_LINES) throw new ToolError('too_large', `${doc.spans.length} lines is over the ${SUBTITLE_MAX_LINES} one call takes.`);
  const input = requestOf(args, doc.spans.map((span) => span.text), signal);
  // All or nothing: half a translated film is not a file anyone wants, and the model would call it done.
  const result = await run(deps, input);
  if (result.changed === 0) throw new ToolError('nothing_translated', `Every line came back unchanged, so the file is probably already in ${input.to.tag}. Nothing was saved.`);
  const { name, ext } = path.parse(file);
  // Players on Windows need the BOM to read CJK as UTF-8; a WebVTT file has to start with its header.
  const body = renderSubtitle(doc, result.lines, args.bilingual === true);
  const saved = await deps.saveOutput(`${name}.${input.to.tag}${ext}`, ext.toLowerCase() === '.vtt' ? body : `${BOM}${body}`);
  return {
    saved_as: saved,
    folder: 'output folder',
    lines: doc.spans.length,
    translated: result.changed,
    unchanged: doc.spans.length - result.changed,
    to: input.to.tag,
    note: MT_NOTE,
  };
}

export function createTranslateMcpServer(deps: TranslateMcpDeps): ToolServer {
  return createToolServer({
    name: TRANSLATE_SERVER_NAME,
    tools: TRANSLATE_TOOLS,
    dispatch: async (toolName, args, signal) => {
      switch (toolName) {
        case 'translate_text': return translateText(deps, args, signal);
        case 'translate_subtitle': return translateSubtitle(deps, args, signal);
        default: throw new Error(`Unknown tool: ${toolName}`);
      }
    },
  });
}
