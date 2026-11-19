/**
 * Any file Chromium can show, as a PDF (`export_file` with "file"). Each kind becomes an HTML page
 * that `htmlToPdf.ts` prints offline:
 * - .docx/.xlsx/.pptx: OfficeCLI's HTML rendering (Yobi's managed copy, or the one found on the
 *   computer; the Office connector need not be on).
 * - .html/.htm: the file itself, which may load what lies beside it.
 * - pictures and .svg: inlined as data: URLs on a page that fits them.
 * - .txt, .csv/.tsv, code and data: escaped text, a table for CSV/TSV.
 * - .md: handed back as Markdown, for the card style every other answer file is drawn in.
 * - .pdf: as it is.
 * The old binary formats (.doc/.xls/.ppt), OpenDocument, RTF and EPUB need LibreOffice; they are
 * refused, and the user is told they cannot be converted.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { resolveTool, toolRunEnv, toolSpec } from '../managedTools';
import { OFFICE_TOOL_NEEDED } from '../office/officeDocumentText';
import { printHtmlFileToPdf } from './htmlToPdf';
import { printOfficeHtmlFile } from './officeHtmlPrint';

const run = promisify(execFile);

/** Past this the file is not a document someone wants printed in a chat answer. */
export const FILE_TO_PDF_MAX_BYTES = 50 * 1024 * 1024;
const OFFICE_RENDER_TIMEOUT_MS = 120_000;

const OFFICE = new Set(['.docx', '.xlsx', '.pptx']);
const HTML = new Set(['.html', '.htm']);
const MARKDOWN = new Set(['.md', '.markdown']);
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
};
const TABLE = new Set(['.csv', '.tsv']);
const TEXT = new Set([
  '.txt', '.log', '.json', '.xml', '.yaml', '.yml', '.ini', '.toml', '.srt', '.vtt',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.sh', '.ps1', '.sql', '.css',
]);
const NEEDS_LIBREOFFICE = new Set(['.doc', '.xls', '.ppt', '.odt', '.ods', '.odp', '.rtf', '.epub', '.pages', '.numbers', '.key']);

export type FileToPdf = { pdf: Buffer } | { markdown: string };

/** A file this module cannot turn into a PDF; the message is for the model. */
export class FileToPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileToPdfError';
  }
}

/** Every extension `fileToPdf` takes, for the tool description and tests. */
export function pdfSourceKind(file: string): 'pdf' | 'office' | 'html' | 'markdown' | 'image' | 'table' | 'text' | 'libreoffice' | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (OFFICE.has(ext)) return 'office';
  if (HTML.has(ext)) return 'html';
  if (MARKDOWN.has(ext)) return 'markdown';
  if (ext in IMAGE_TYPES) return 'image';
  if (TABLE.has(ext)) return 'table';
  if (TEXT.has(ext)) return 'text';
  if (NEEDS_LIBREOFFICE.has(ext)) return 'libreoffice';
  return null;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE_STYLE = '<style>@page{size:A4;margin:16mm}body{margin:0;font-family:"Microsoft JhengHei","PingFang TC","Noto Sans CJK TC",sans-serif;font-size:11pt;color:#111}'
  + 'pre{white-space:pre-wrap;word-break:break-word;font-family:Consolas,"Cascadia Mono",Menlo,monospace;font-size:9.5pt;margin:0}'
  + 'table{border-collapse:collapse;font-size:9pt}td,th{border:1px solid #999;padding:3px 6px;vertical-align:top}th{background:#eee}'
  + 'img{display:block;max-width:100%;max-height:260mm;margin:0 auto}</style>';

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${PAGE_STYLE}</head><body>${body}</body></html>`;
}

/** Splits CSV/TSV into rows, honouring double quotes (a quoted field may hold the separator and newlines). */
export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === separator) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export function tablePage(title: string, rows: string[][]): string {
  const [head, ...body] = rows;
  const cells = (cellsOf: string[], tag: 'td' | 'th'): string => cellsOf.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join('');
  const thead = head ? `<thead><tr>${cells(head, 'th')}</tr></thead>` : '';
  return page(title, `<table>${thead}<tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`);
}

async function printPage(html: string, signal?: AbortSignal): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-pdf-'));
  try {
    const file = path.join(dir, 'page.html');
    await fs.writeFile(file, html, 'utf8');
    return await printHtmlFileToPdf(file, signal);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function officeToPdf(file: string, signal?: AbortSignal): Promise<Buffer> {
  const copy = await resolveTool('officecli');
  if (!copy) throw new FileToPdfError(OFFICE_TOOL_NEEDED);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-pdf-'));
  try {
    const html = path.join(dir, 'document.html');
    await run(copy.path, ['view', file, 'html', '--out', html], {
      env: toolRunEnv(toolSpec('officecli'), copy.source), timeout: OFFICE_RENDER_TIMEOUT_MS, windowsHide: true, ...(signal ? { signal } : {}),
    });
    return await printOfficeHtmlFile(html, signal);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Several pictures beside one another in a chat are one PDF: this many at most. */
export const PICTURES_TO_PDF_MAX = 50;

/** One page per picture, each fitted to the page, in the order given. The caller has checked they may be read. */
export async function picturesToPdf(files: readonly string[], signal?: AbortSignal): Promise<Buffer> {
  if (files.length > PICTURES_TO_PDF_MAX) throw new FileToPdfError(`One PDF holds ${PICTURES_TO_PDF_MAX} pictures at most.`);
  const other = files.find((file) => !IMAGE_TYPES[path.extname(file).toLowerCase()]);
  if (other) throw new FileToPdfError(`"${path.basename(other)}" is not a picture; several files become one PDF only when every one is a picture.`);
  let total = 0;
  const pages: string[] = [];
  for (const file of files) {
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    const data = await fs.readFile(file);
    total += data.length;
    if (total > FILE_TO_PDF_MAX_BYTES) throw new FileToPdfError(`The pictures are larger than ${FILE_TO_PDF_MAX_BYTES / 1024 / 1024} MB together.`);
    pages.push(`<img alt="" src="data:${type};base64,${data.toString('base64')}">`);
  }
  const body = pages.map((img, i) => `<div style="${i < pages.length - 1 ? 'break-after:page;' : ''}">${img}</div>`).join('');
  return printPage(page(path.basename(files[0] ?? ''), body), signal);
}

/** Turns one readable file into PDF bytes (or Markdown for the card renderer). The caller has checked it may be read. */
export async function fileToPdf(file: string, signal?: AbortSignal): Promise<FileToPdf> {
  const kind = pdfSourceKind(file);
  const name = path.basename(file);
  if (kind === 'libreoffice') {
    // Said plainly, with nothing to do on a computer: the user may be on a phone.
    throw new FileToPdfError(`"${name}" is an older or OpenDocument format (.doc, .xls, .ppt, OpenDocument, RTF, EPUB…) this app cannot turn into a PDF. Tell the user plainly that this format cannot be converted here; do not try another way.`);
  }
  if (!kind) {
    throw new FileToPdfError(`"${name}" is not a kind of file this app can turn into a PDF (documents, spreadsheets, slides, web pages, pictures and text can be).`);
  }
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new FileToPdfError(`"${name}" is not a file.`);
  if (stat.size > FILE_TO_PDF_MAX_BYTES) throw new FileToPdfError(`"${name}" is larger than ${FILE_TO_PDF_MAX_BYTES / 1024 / 1024} MB.`);
  switch (kind) {
    case 'pdf': return { pdf: await fs.readFile(file) };
    case 'office': return { pdf: await officeToPdf(file, signal) };
    case 'html': return { pdf: await printHtmlFileToPdf(file, signal) };
    case 'markdown': return { markdown: await fs.readFile(file, 'utf8') };
    case 'image': {
      const data = (await fs.readFile(file)).toString('base64');
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
      return { pdf: await printPage(page(name, `<img alt="" src="data:${type};base64,${data}">`), signal) };
    }
    case 'table': {
      const text = await fs.readFile(file, 'utf8');
      return { pdf: await printPage(tablePage(name, parseDelimited(text.replace(/^﻿/, ''), path.extname(file).toLowerCase() === '.tsv' ? '\t' : ',')), signal) };
    }
    case 'text': {
      const text = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '');
      return { pdf: await printPage(page(name, `<pre>${escapeHtml(text)}</pre>`), signal) };
    }
  }
}
