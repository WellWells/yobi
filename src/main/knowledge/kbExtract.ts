/**
 * The text of one knowledge-base file, without any tool the user would have to install.
 *
 * Word, PowerPoint and Excel files are zip archives of XML: their text is read straight out of the
 * XML (measured against OfficeCLI's `view text` on real files: docx 98–100% — only list
 * bullets missing, and tables included, which `view text` leaves out — pptx and xlsx 100%, 1–4 ms a
 * file). Tags are matched with any namespace prefix: Excel files written by other programs use
 * `x:` instead of none. PDFs go through the same reader as `file_read`, with room for a whole book.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { pdfPageMarker, readPdfText } from '../flow/skills/pdfText';
import { FlowUserError } from '../flow/userError';
import { KB_OCR_ERROR_PREFIX, isKbImage, ocrAvailable, ocrFileText, ocrPdfPages } from './kbOcr';
import type { KbOcrRead } from './kbOcr';
import { readKnowledgeCut } from '../../shared/knowledgeStatus';
import type { KnowledgeCut } from '../../shared/knowledgeStatus';

export const KB_TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.html', '.htm'] as const;
export const KB_OFFICE_EXTENSIONS = ['.docx', '.pptx', '.xlsx'] as const;
export const KB_EXTENSIONS: readonly string[] = [...KB_TEXT_EXTENSIONS, ...KB_OFFICE_EXTENSIONS, '.pdf'];

/** Larger files are listed as skipped: a knowledge base is documents, not data dumps. */
export const KB_MAX_FILE_BYTES = 100 * 1024 * 1024;
/** One file's text is cut here; a whole book (762 pages, 357k characters) measured ≈ 1 s. */
export const KB_MAX_FILE_CHARS = 3_000_000;
const KB_PDF_LIMITS = { maxPages: 5_000, maxChars: KB_MAX_FILE_CHARS };

/** Pictures are documents only where OCR can read them. */
export function isKbFile(file: string, platform: NodeJS.Platform = process.platform): boolean {
  return KB_EXTENSIONS.includes(path.extname(file).toLowerCase()) || (ocrAvailable(platform) && isKbImage(file));
}

const ENTITY = /&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|amp|quot|apos));/gi;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name.toLowerCase()] ?? match;
    const code = dec ? Number(dec) : Number.parseInt(hex ?? '', 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

const P = String.raw`(?:[\w.-]+:)?`;

function elements(xml: string, local: string): string[] {
  const pattern = new RegExp(String.raw`<${P}${local}(?:\s[^>]*)?>([\s\S]*?)</${P}${local}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

/** The text runs of one paragraph-like element; tabs and breaks kept as whitespace. */
function runsText(xml: string, run: string): string {
  const marked = xml
    .replace(new RegExp(String.raw`<${P}tab\b[^>]*/>`, 'g'), `<${run}>\t</${run}>`)
    .replace(new RegExp(String.raw`<${P}br\b[^>]*/>`, 'g'), `<${run}>\n</${run}>`);
  return decodeEntities(elements(marked, run).map((inner) => inner.replace(/<[^>]+>/g, '')).join(''));
}

function zipText(zip: AdmZip, name: string): string {
  const entry = zip.getEntry(name);
  return entry ? entry.getData().toString('utf8') : '';
}

function numbered(zip: AdmZip, pattern: RegExp): string[] {
  return zip.getEntries()
    .map((entry) => entry.entryName)
    .filter((name) => pattern.test(name))
    .sort((a, b) => Number(pattern.exec(a)?.[1] ?? 0) - Number(pattern.exec(b)?.[1] ?? 0));
}

const DOCX_HEADING = /<(?:[\w.-]+:)?pStyle\b[^>]*?(?:[\w.-]+:)?val="(?:Heading|heading|Title)\s?(\d?)"/;

function docxText(zip: AdmZip): string {
  const body = zipText(zip, 'word/document.xml');
  return elements(body, 'p')
    .map((paragraph) => {
      const text = runsText(paragraph, 't').trim();
      if (!text) return '';
      const heading = DOCX_HEADING.exec(paragraph);
      return heading ? `${'#'.repeat(Math.min(6, Number(heading[1] || 1)))} ${text}` : text;
    })
    .filter(Boolean)
    .join('\n\n');
}

function pptxText(zip: AdmZip): string {
  return numbered(zip, /^ppt\/slides\/slide(\d+)\.xml$/)
    .map((name, index) => {
      const paragraphs = elements(zipText(zip, name), 'p').map((paragraph) => runsText(paragraph, 't').trim()).filter(Boolean);
      return paragraphs.length ? `## Slide ${index + 1}\n\n${paragraphs.join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** `C` → 2: a cell reference's column, from 0. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1]?.toUpperCase() ?? '';
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * The workbook's sheets in its own order, each with its name and the part that holds it — through
 * the workbook's relationships, as Open XML names them; sheet parts by number only when a workbook
 * has no relationships to follow. Pairing names with `sheetN.xml` by position puts
 * one sheet's rows under another's name.
 */
function xlsxSheets(zip: AdmZip): { name: string; part: string }[] {
  const targets = new Map<string, string>();
  for (const rel of zipText(zip, 'xl/_rels/workbook.xml.rels').matchAll(new RegExp(String.raw`<${P}Relationship\b[^>]*>`, 'g'))) {
    const id = /\sId="([^"]*)"/.exec(rel[0])?.[1];
    const target = /\sTarget="([^"]*)"/.exec(rel[0])?.[1];
    if (!id || !target) continue;
    targets.set(id, target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`));
  }
  const declared = [...zipText(zip, 'xl/workbook.xml').matchAll(new RegExp(String.raw`<${P}sheet\b[^>]*>`, 'g'))].map((match) => ({
    name: decodeEntities(/\sname="([^"]*)"/.exec(match[0])?.[1] ?? ''),
    part: targets.get(/\s(?:[\w.-]+:)?id="([^"]*)"/.exec(match[0])?.[1] ?? '') ?? '',
  }));
  if (declared.length > 0 && declared.every((sheet) => sheet.part && zip.getEntry(sheet.part))) return declared;
  return numbered(zip, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((part, index) => ({ name: declared[index]?.name ?? '', part }));
}

/**
 * A row's cells at their columns: a blank cell between two values stays a blank column
 * (`Server | (empty) | 100` read as `Server\t100` puts the actual spend under the budget's header).
 */
function xlsxRow(row: string, shared: readonly string[]): string {
  const cells: string[] = [];
  for (const cell of row.matchAll(new RegExp(String.raw`<${P}c\b([^>]*?)(?:/>|>([\s\S]*?)</${P}c>)`, 'g'))) {
    const attrs = cell[1];
    const inner = cell[2] ?? '';
    const type = /\st="([^"]*)"/.exec(attrs)?.[1];
    const ref = /\sr="([^"]*)"/.exec(attrs)?.[1];
    let value: string;
    if (type === 'inlineStr') value = runsText(inner, 't');
    else {
      const raw = decodeEntities(elements(inner, 'v')[0] ?? '');
      value = type === 's' ? shared[Number(raw)] ?? '' : raw;
    }
    const at = ref ? columnIndex(ref) : cells.length;
    while (cells.length < at) cells.push('');
    cells[at >= 0 ? at : cells.length] = value;
  }
  return cells.join('\t').trimEnd();
}

function xlsxText(zip: AdmZip): string {
  const shared = elements(zipText(zip, 'xl/sharedStrings.xml'), 'si').map((item) => runsText(item, 't'));
  return xlsxSheets(zip)
    .map(({ name, part }, index) => {
      const rows = elements(zipText(zip, part), 'row').map((row) => xlsxRow(row, shared)).filter((row) => row.trim());
      return rows.length ? `## ${name || `Sheet ${index + 1}`}\n\n${rows.join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Plain text in UTF-8 (BOM or not) or UTF-16 with a BOM; anything else is read in the legacy
 * encoding of the user's language — a Big5 file from a Taiwanese office, GBK from a mainland one.
 * Chosen by the UI language, not the system code page: Windows set to UTF-8 (65001) still has
 * years of Big5 files.
 */
export function decodeText(bytes: Uint8Array, uiLanguage: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    const legacy = uiLanguage === 'zh-CN' ? 'gbk' : uiLanguage === 'zh-TW' ? 'big5' : 'windows-1252';
    return new TextDecoder(legacy).decode(bytes);
  }
}

function htmlText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A PDF the reader found no text in: its pages are pictures (a scan), or its fonts map to no characters. */
function isTextlessPdf(err: unknown): boolean {
  return err instanceof FlowUserError && (err.key === 'flow.error.pdfNoText' || err.key === 'flow.error.pdfFontUnreadable');
}

/** OCR's text, or a failure that says OCR ran and found nothing (`KB_OCR_ERROR_PREFIX`). */
async function ocrText(file: string, kind: 'pdf' | 'image', signal?: AbortSignal): Promise<string> {
  const text = await ocrFileText(file, kind, signal);
  if (!text.trim()) throw new Error(`${KB_OCR_ERROR_PREFIX} no text recognised`);
  return text;
}

/**
 * The file's text, cut at `KB_MAX_FILE_CHARS`. Throws when the file cannot be read as its type.
 * A scanned PDF and a picture are read by OCR where this computer has it (`kbOcr.ts`).
 */
export async function extractKbText(file: string, uiLanguage: string, signal?: AbortSignal): Promise<string> {
  return (await extractKbDocument(file, uiLanguage, signal)).text;
}

/** The pages of the PDF reader's text that came out empty: `--- page N ---` with nothing under it. */
export function emptyPdfPages(text: string): number[] {
  const empty: number[] = [];
  const sections = text.split(/\n\n(?=--- page \d+ ---)/);
  for (const section of sections) {
    const match = /^--- page (\d+) ---\s*$/.exec(section);
    if (match) empty.push(Number(match[1]));
  }
  return empty;
}

/** The reader's text with OCR's text put under the pages it read. */
export function withOcrPages(text: string, ocr: ReadonlyMap<number, string>): string {
  return text.split(/\n\n(?=--- page \d+ ---)/).map((section) => {
    const match = /^--- page (\d+) ---\s*$/.exec(section);
    const found = match ? ocr.get(Number(match[1])) : undefined;
    return found ? `${pdfPageMarker(Number(match?.[1]))}\n${found}` : section;
  }).join('\n\n');
}

/**
 * The scanned pages of a PDF whose other pages have text (a contract with a scanned
 * signature page would lose that page if the whole file counted as text and OCR never ran). Only
 * the empty pages are recognised; a blank separator page simply yields nothing. An OCR failure
 * keeps the text the reader found: it is never worse than before.
 */
async function withScannedPages(file: string, text: string, signal?: AbortSignal): Promise<{ text: string; ocr: KbOcrRead }> {
  const empty = emptyPdfPages(text);
  if (empty.length === 0 || !ocrAvailable()) return { text, ocr: 'none' };
  try {
    const read = await ocrPdfPages(file, empty, signal);
    return read.size > 0 ? { text: withOcrPages(text, read), ocr: 'partial' } : { text, ocr: 'none' };
  } catch (err) {
    if (signal?.aborted) throw err;
    return { text, ocr: 'none' };
  }
}

/**
 * The file's text and how OCR took part in reading it (the file list shows how each file was
 * read): `full` = the whole file is OCR's, `partial` = some of a PDF's pages are.
 */
export async function extractKbDocument(file: string, uiLanguage: string, signal?: AbortSignal): Promise<KbExtracted> {
  const ext = path.extname(file).toLowerCase();
  if (isKbImage(file)) return finished(await ocrText(file, 'image', signal), 'full');
  const bytes = await fs.readFile(file);
  let text: string;
  if (ext === '.pdf') {
    try {
      text = await readPdfText(bytes, path.basename(file), KB_PDF_LIMITS);
    } catch (err) {
      if (!isTextlessPdf(err) || !ocrAvailable()) throw err;
      return finished(await ocrText(file, 'pdf', signal), 'full');
    }
    const mixed = await withScannedPages(file, text, signal);
    return finished(mixed.text, mixed.ocr);
  } else if ((KB_OFFICE_EXTENSIONS as readonly string[]).includes(ext)) {
    const zip = new AdmZip(bytes);
    text = ext === '.docx' ? docxText(zip) : ext === '.pptx' ? pptxText(zip) : xlsxText(zip);
  } else {
    const decoded = decodeText(bytes, uiLanguage);
    text = ext === '.html' || ext === '.htm' ? htmlText(decoded) : decoded;
  }
  return finished(text, 'none');
}

export interface KbExtracted {
  text: string;
  ocr: KbOcrRead;
  /** Reading stopped short of the whole file; absent = all of it was read. */
  cut?: KnowledgeCut;
}

const TRUNCATED_AT = /--- truncated: text ends at page (\d+) of (\d+) ---/;

/**
 * Where reading stopped, only when it did: the PDF reader's and OCR's own
 * "truncated" line names the page; past `KB_MAX_FILE_CHARS` it is the characters kept.
 */
export function extractionCut(text: string, max = KB_MAX_FILE_CHARS): KnowledgeCut | undefined {
  const pages = TRUNCATED_AT.exec(text);
  if (pages) {
    const cut = readKnowledgeCut({ page: Number(pages[1]), pages: Number(pages[2]) });
    if (cut) return cut;
  }
  return text.length > max ? { chars: max, total: text.length } : undefined;
}

function finished(text: string, ocr: KbOcrRead): KbExtracted {
  const cut = extractionCut(text);
  const kept = text.length > KB_MAX_FILE_CHARS ? text.slice(0, KB_MAX_FILE_CHARS) : text;
  return cut ? { text: kept, ocr, cut } : { text: kept, ocr };
}

/**
 * A file that failed before this computer could OCR it — a scan the reader found no text in — is
 * read again once; one OCR already failed on keeps its error until the file changes.
 */
export function retryWithOcr(file: string, error: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!error || error.startsWith(KB_OCR_ERROR_PREFIX) || !ocrAvailable(platform)) return false;
  return path.extname(file).toLowerCase() === '.pdf' && /no text layer|no character mapping/.test(error);
}
