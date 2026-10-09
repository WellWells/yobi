import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fdir } from 'fdir';
import dayjs from 'dayjs';
import type { OutputFile } from '../shared/types';
import { latestTurnProvider, parseConversationDoc, visibleConversationText } from '../shared/conversationDoc';
import type { ConversationDoc, ConversationHeadingAliases, ConversationTurn } from '../shared/conversationDoc';

type MarkdownHeadingAliases = ConversationHeadingAliases;

function createEmptyHeadingAliases(): MarkdownHeadingAliases {
  return {
    provider: new Set<string>(),
    time: new Set<string>(),
    prompt: new Set<string>(),
    response: new Set<string>(),
  };
}

export async function getOutputDir(): Promise<string> {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), 'outputs')
    : path.resolve('./outputs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function getLanguageDir(): string {
  if (!app.isPackaged) return path.resolve('language');
  return path.join(__dirname, '..', 'language');
}

export function getUserLanguageDir(): string {
  return path.join(app.getPath('userData'), 'languages');
}

type OutputFileCacheEntry = {
  mtimeMs: number;
  size: number;
  file: OutputFile;
};

const outputFileCache = new Map<string, OutputFileCacheEntry>();

export function compareOutputFilesByTime(a: OutputFile, b: OutputFile): number {
  if (a.timestamp && b.timestamp) {
    return b.timestamp.localeCompare(a.timestamp) || b.name.localeCompare(a.name);
  }
  if (a.timestamp) return -1;
  if (b.timestamp) return 1;
  return b.name.localeCompare(a.name);
}

export async function listOutputFiles(): Promise<OutputFile[]> {
  const dir = await getOutputDir();
  try {
    const headingAliases = await loadMarkdownHeadingAliases();
    const filePaths = await getOutputMarkdownPaths(dir);
    const files = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const stat = await fs.stat(filePath);
          const cached = outputFileCache.get(filePath);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.file;
          }
          const content = await fs.readFile(filePath, 'utf-8');
          const file = buildOutputFile(filePath, content, headingAliases);
          outputFileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, file });
          return file;
        } catch {
          return buildOutputFile(filePath, '', headingAliases);
        }
      }),
    );
    if (outputFileCache.size > filePaths.length) {
      const live = new Set(filePaths);
      for (const key of outputFileCache.keys()) {
        if (!live.has(key)) outputFileCache.delete(key);
      }
    }
    return files.sort(compareOutputFilesByTime);
  } catch {
    return [];
  }
}

export async function searchOutputFiles(query: string): Promise<OutputFile[]> {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return listOutputFiles();

  const dir = await getOutputDir();
  try {
    const headingAliases = await loadMarkdownHeadingAliases();
    const filePaths = await getOutputMarkdownPaths(dir);
    // Read concurrently, like `listOutputFiles`: the search palette debounces at 80ms, so a
    // sequential pass over the whole archive lands on the main process once per keystroke and
    // grows with every conversation ever saved.
    const matches = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          return matchOutputFile(filePath, content, headingAliases, keyword);
        } catch {
          return null;
        }
      }),
    );
    return matches
      .filter((file): file is OutputFile => file !== null)
      .sort(compareOutputFilesByTime);
  } catch {
    return [];
  }
}

/**
 * Crawled off the main thread on purpose: this runs after every saved answer, on every
 * debounced search keystroke and once per flow history write, and a sync crawl blocks IPC and
 * window events for as long as it takes — which grows with the size of the archive.
 */
export async function getOutputMarkdownPaths(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const paths = await new fdir()
    .withFullPaths()
    .filter((entryPath, isDirectory) => isDirectory || entryPath.endsWith('.md'))
    .crawl(dir)
    .withPromise();
  return paths.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
}

function addHeadingAlias(aliasSet: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (!normalized) return;
  aliasSet.add(normalized);
}

let headingAliasesCache: MarkdownHeadingAliases | null = null;

export async function loadMarkdownHeadingAliases(): Promise<MarkdownHeadingAliases> {
  if (headingAliasesCache) return headingAliasesCache;
  const aliases = createEmptyHeadingAliases();
  const dirs = [
    getLanguageDir(),
    path.join(getLanguageDir(), 'community'),
    getUserLanguageDir(),
  ];
  await Promise.all(dirs.map((dir) => collectHeadingAliases(dir, aliases)));
  if (aliases.provider.size > 0 || aliases.time.size > 0) {
    headingAliasesCache = aliases;
  }
  return aliases;
}

async function collectHeadingAliases(langDir: string, aliases: MarkdownHeadingAliases): Promise<void> {
  try {
    const files = await fs.readdir(langDir);
    const langFiles = files.filter((fileName) => fileName.endsWith('.json'));
    await Promise.all(
      langFiles.map(async (fileName) => {
        try {
          const filePath = path.join(langDir, fileName);
          const raw = await fs.readFile(filePath, 'utf-8');
          const translations = JSON.parse(raw) as Record<string, unknown>;
          addHeadingAlias(aliases.provider, translations['md.provider']);
          addHeadingAlias(aliases.time, translations['md.timestamp']);
          addHeadingAlias(aliases.prompt, translations['md.prompt']);
          addHeadingAlias(aliases.response, translations['md.response']);
        } catch {
        }
      }),
    );
  } catch {
  }
}

function extractMetaByAliases(content: string, headingAliases: Set<string>): string | null {
  if (headingAliases.size === 0) return null;
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const headingMatch = lines[i].trim().match(/^##\s+(.+)$/);
    if (!headingMatch) continue;
    if (!headingAliases.has(headingMatch[1].trim())) continue;
    const sectionLines: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      // Stop at the first turn's `yobi:turn` marker, which sits between the `## Time` value
      // and `## Prompt`.
      if (/^##\s+/.test(lines[j]) || /^<!--\s*yobi:/.test(lines[j].trim())) break;
      sectionLines.push(lines[j]);
    }
    const sectionValue = sectionLines.join('\n').trim();
    return sectionValue || null;
  }
  return null;
}

function readOutputFile(
  filePath: string,
  content: string,
  headingAliases: MarkdownHeadingAliases,
): { file: OutputFile; doc: ConversationDoc | null } {
  const name = path.basename(filePath);
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const h1Match = firstLine.match(/^#\s+(.+)$/);
  const doc = content ? parseConversationDoc(content, headingAliases) : null;
  const provider = latestTurnProvider(doc?.turns ?? [])
    ?? extractMetaByAliases(content, headingAliases.provider);
  const timestamp = latestTurnTimestamp(doc?.turns ?? [])
    || extractTimestampFromContent(content, headingAliases.time)
    || extractTimestampFromFileName(name);
  const preview = h1Match
    ? h1Match[1]
    : (content.slice(0, 200).replace(/\n/g, ' ').trim() || name);

  return {
    file: {
      name,
      path: filePath,
      timestamp,
      preview,
      provider: provider || undefined,
      turns: Math.max(1, doc?.turns.length ?? 0),
    },
    doc,
  };
}

export function buildOutputFile(filePath: string, content: string, headingAliases: MarkdownHeadingAliases): OutputFile {
  return readOutputFile(filePath, content, headingAliases).file;
}

/**
 * Matches what the row and the conversation show: the title, the provider badge, the prompts
 * and the answers — not the metadata sections, headings and JSON markers stored around them.
 * The raw text is checked first only as a cheap reject, since everything visible is in it.
 */
export function matchOutputFile(
  filePath: string,
  content: string,
  headingAliases: MarkdownHeadingAliases,
  keyword: string,
): OutputFile | null {
  if (!`${path.basename(filePath)}\n${content}`.toLowerCase().includes(keyword)) return null;
  const { file, doc } = readOutputFile(filePath, content, headingAliases);
  const visible = [
    file.preview,
    file.provider ?? '',
    content ? visibleConversationText(content, headingAliases, doc ?? undefined) : '',
  ].join('\n').toLowerCase();
  return visible.includes(keyword) ? file : null;
}

export function buildSafeFileNameFromTitle(title: string): string {
  const sanitized = title
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return sanitized || 'untitled';
}

export async function getUniquePath(desiredPath: string, originalPath: string): Promise<string> {
  if (desiredPath.toLowerCase() === originalPath.toLowerCase()) return originalPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const stem = path.basename(desiredPath, ext);
  let candidate = desiredPath;
  let idx = 2;
  while (existsSync(candidate) && candidate.toLowerCase() !== originalPath.toLowerCase()) {
    candidate = path.join(dir, `${stem} (${idx})${ext}`);
    idx += 1;
  }
  return candidate;
}

function extractTimestampFromFileName(name: string): string {
  const match = name.match(/(\d{4})-(\d{2})-(\d{2})[-_](\d{2})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match;
  return toIsoTimestamp(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

/**
 * When the conversation last moved: the newest reply time any turn recorded. The list is ordered
 * by it, the way chat sites order theirs, so a follow-up lifts an old conversation back to the
 * top; the `## Time` section only records when the first turn was saved. File mtime is not used:
 * renaming, retitling and thread-marker stamps rewrite the file without anyone talking.
 */
function latestTurnTimestamp(turns: readonly ConversationTurn[]): string {
  let latest = '';
  for (const turn of turns) {
    const stamp = typeof turn.meta.t === 'string' ? toIsoTimestamp(turn.meta.t) : '';
    if (stamp > latest) latest = stamp;
  }
  return latest;
}

function extractTimestampFromContent(content: string, timestampHeadingAliases: Set<string>): string {
  const raw = extractMetaByAliases(content, timestampHeadingAliases);
  return toIsoTimestamp(raw ?? '');
}

function toIsoTimestamp(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) return '';
  const parsed = dayjs(normalized);
  if (parsed.isValid()) return parsed.toISOString();
  const fallbackParsed = dayjs(normalized.replace(' ', 'T'));
  return fallbackParsed.isValid() ? fallbackParsed.toISOString() : '';
}

export function buildSnapshotFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    '-snapshot',
  ].join('');
}
