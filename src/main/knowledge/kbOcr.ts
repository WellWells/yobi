/**
 * Text from scanned PDFs and pictures, on this computer only, with what Windows already has: the
 * built-in PDF renderer (`Windows.Data.Pdf`) draws each page, the built-in OCR (`Windows.Media.Ocr`,
 * in the user's own profile languages) reads it. Nothing to install, nothing leaves the computer.
 * Measured on a scanned zh-TW phone bill: one page in 1.5 s including PowerShell's start,
 * every number, date and line item read; only a vertical side banner came out garbled.
 *
 * Other platforms have no OCR here yet: their scans stay listed as unreadable.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export const KB_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'] as const;
/** A scan longer than this is read up to here: OCR is ~1 s a page. */
export const KB_OCR_MAX_PAGES = 300;
/** One file's OCR is given up after this. */
const KB_OCR_TIMEOUT_MS = 10 * 60_000;
/** The error a file keeps when OCR ran and found nothing: such a file is not read again until it changes. */
export const KB_OCR_ERROR_PREFIX = 'ocr:';

/** How OCR took part in reading a file: not at all, the whole file, or some of a PDF's pages. */
export type KbOcrRead = 'none' | 'full' | 'partial';

export function ocrAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

export function isKbImage(file: string): boolean {
  return (KB_IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(file).toLowerCase());
}

// The WinRT plumbing both scripts share: awaiting WinRT calls from PowerShell, and the types used.
// A file's path comes in an environment variable, never inside the script text.
const WINRT_PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ext = [System.WindowsRuntimeSystemExtensions]
$opTask = ($ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
$actTask = ($ext.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$type) { $task = $opTask.MakeGenericMethod($type).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $actTask.Invoke($null, @($op)).Wait(-1) | Out-Null }
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
`;

const OCR_SCRIPT = WINRT_PRELUDE + String.raw`
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { [Console]::Out.WriteLine('{"error":"no OCR language"}'); exit 3 }
function Read-Bitmap($bitmap, [int]$n) {
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ page = $n; text = ($lines -join "${'`'}n") }))
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:YOBI_OCR_FILE)) ([Windows.Storage.StorageFile])
if ($env:YOBI_OCR_KIND -eq 'pdf') {
  $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $count = [Math]::Min($doc.PageCount, [int]$env:YOBI_OCR_MAX_PAGES)
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ pages = $doc.PageCount }))
  # YOBI_OCR_PAGES: only these pages (1-based, comma-separated) — the scanned pages of a PDF whose
  # other pages have a text layer; unset = every page.
  if ($env:YOBI_OCR_PAGES) {
    $list = @($env:YOBI_OCR_PAGES -split ',' | ForEach-Object { [int]$_ - 1 } | Where-Object { $_ -ge 0 -and $_ -lt $doc.PageCount })
  } else {
    $list = @(for ($n = 0; $n -lt $count; $n++) { $n })
  }
  foreach ($i in $list) {
    $page = $doc.GetPage($i)
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $opts = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
    $width = [Math]::Min([double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension, [Math]::Max(1600.0, $page.Size.Width * 2.5))
    $opts.DestinationWidth = [uint32]$width
    AwaitAction ($page.RenderToStreamAsync($stream, $opts))
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    Read-Bitmap $bitmap ($i + 1)
    $page.Dispose()
  }
} else {
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  Read-Bitmap $bitmap 1
}
`;

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯`;
// A space after CJK before CJK, a digit or a colon; and after a digit, colon or bracket before CJK.
const SPACE_AFTER_CJK = new RegExp(String.raw`(?<=[${CJK}])[ \t]+(?=[${CJK}\d:(])`, 'gu');
const SPACE_BEFORE_CJK = new RegExp(String.raw`(?<=[\d:)])[ \t]+(?=[${CJK}])`, 'gu');
const SPACE_IN_NUMBER = /(?<=\d)[ \t]*([,.\/:])[ \t]*(?=\d)|(?<=\d)[ \t]+(?=\d)/g;

/**
 * Windows' OCR puts a space between every CJK character (「中 華 電 信」) and around a number's
 * separators (「$ 3 , 250」): neither a search for 中華電信 nor for 3,250 would find them. Latin
 * words keep their spaces (「MOD 專案」).
 */
export function tidyOcrLine(line: string): string {
  return line
    .replace(SPACE_IN_NUMBER, (_match, sep: string | undefined) => sep ?? '')
    .replace(SPACE_AFTER_CJK, '')
    .replace(SPACE_BEFORE_CJK, '')
    .trim();
}

interface OcrLine {
  page?: number;
  text?: string;
  pages?: number;
  error?: string;
}

/** Each page OCR recognised text on, tidied, in the order read; and the document's page count. */
export function ocrOutputPages(stdout: string): { pages: number; text: Map<number, string> } {
  const text = new Map<number, string>();
  let pages = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim().startsWith('{')) continue;
    let line: OcrLine;
    try {
      line = JSON.parse(raw) as OcrLine;
    } catch {
      continue;
    }
    if (typeof line.pages === 'number') pages = line.pages;
    if (typeof line.page !== 'number' || typeof line.text !== 'string') continue;
    const body = line.text.split('\n').map(tidyOcrLine).filter(Boolean).join('\n');
    if (body) text.set(line.page, body);
  }
  return { pages, text };
}

/** The OCR output as the PDF reader writes text: each page after its `--- page N ---` line. */
export function ocrOutputText(stdout: string, kind: 'pdf' | 'image'): string {
  const { pages, text } = ocrOutputPages(stdout);
  const sections = [...text].map(([page, body]) => (kind === 'pdf' ? `--- page ${page} ---\n${body}` : body));
  const last = Math.max(0, ...text.keys());
  if (kind === 'pdf' && pages > last && last >= KB_OCR_MAX_PAGES) sections.push(`--- truncated: text ends at page ${last} of ${pages} ---`);
  return sections.join('\n\n');
}

/** Runs one of these scripts in Windows PowerShell; resolves its standard output. */
function runWinRtScript(script: string, env: Record<string, string>, label: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // -EncodedCommand, not a script on stdin: stdin is run line by line and breaks every block.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const stop = (): void => { child.kill(); };
    const timer = setTimeout(stop, KB_OCR_TIMEOUT_MS);
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      const stdout = Buffer.concat(out).toString('utf8');
      if (code !== 0) {
        const detail = stdout.includes('"error"') ? stdout.trim() : Buffer.concat(err).toString('utf8').trim().split(/\r?\n/)[0] ?? '';
        reject(new Error(`${label} failed (exit ${code ?? 'killed'}): ${detail.slice(0, 200)}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end();
  });
}

/** The text OCR finds in a scanned PDF or a picture; '' when it finds none. Throws when OCR cannot run. */
export async function ocrFileText(file: string, kind: 'pdf' | 'image', signal?: AbortSignal): Promise<string> {
  const stdout = await runWinRtScript(OCR_SCRIPT, { YOBI_OCR_FILE: file, YOBI_OCR_KIND: kind, YOBI_OCR_MAX_PAGES: String(KB_OCR_MAX_PAGES) }, 'OCR', signal);
  return ocrOutputText(stdout, kind);
}

/** OCR of these pages of a PDF only (1-based): the text each one yielded; pages with none are absent. */
export async function ocrPdfPages(file: string, pages: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const list = pages.slice(0, KB_OCR_MAX_PAGES).join(',');
  if (!list) return new Map();
  const stdout = await runWinRtScript(OCR_SCRIPT, {
    YOBI_OCR_FILE: file, YOBI_OCR_KIND: 'pdf', YOBI_OCR_MAX_PAGES: String(KB_OCR_MAX_PAGES), YOBI_OCR_PAGES: list,
  }, 'OCR', signal);
  return ocrOutputPages(stdout).text;
}

const RENDER_SCRIPT = WINRT_PRELUDE + String.raw`
[Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.CreationCollisionOption, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:YOBI_OCR_FILE)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($env:YOBI_RENDER_DIR)) ([Windows.Storage.StorageFolder])
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ pages = $doc.PageCount }))
$count = [Math]::Min($doc.PageCount, [int]$env:YOBI_OCR_MAX_PAGES)
for ($i = 0; $i -lt $count; $i++) {
  $page = $doc.GetPage($i)
  $out = Await ($folder.CreateFileAsync("page-$($i + 1).png", [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $stream = Await ($out.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  $opts = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
  $opts.DestinationWidth = [uint32]1600
  AwaitAction ($page.RenderToStreamAsync($stream, $opts))
  $stream.Dispose()
  $page.Dispose()
  [Console]::Out.WriteLine($out.Path)
}
`;

/**
 * The PDF's first `maxPages` pages as PNG files in `outDir` (1600 px wide), for a model that reads
 * pictures but not PDFs (an API key). Windows only, like OCR.
 */
export async function renderPdfPages(file: string, outDir: string, maxPages: number, signal?: AbortSignal): Promise<{ files: string[]; pages: number }> {
  const stdout = await runWinRtScript(RENDER_SCRIPT, { YOBI_OCR_FILE: file, YOBI_RENDER_DIR: outDir, YOBI_OCR_MAX_PAGES: String(maxPages) }, 'PDF render', signal);
  const files = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.toLowerCase().endsWith('.png'));
  // The script's first line is the document's page count: past `maxPages` the summary saw part of it.
  return { files, pages: ocrOutputPages(stdout).pages || files.length };
}
