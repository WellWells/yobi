import * as path from 'node:path';
import { FlowUserError } from '../userError';

type PDFDocumentProxy = Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

/**
 * How much of one PDF `file_read` turns into text. pdf.js runs on the main process's own thread
 * here (no worker), so both bounds also bound how long a read can keep it busy; 300 text pages
 * measured ~0.3 s with the event loop never starved for more than ~15 ms.
 */
export interface PdfLimits {
  maxPages: number;
  maxChars: number;
}

export const PDF_LIMITS: PdfLimits = { maxPages: 500, maxChars: 500_000 };

const PDF_MAGIC = '%PDF-';

/** A `.pdf` name, or PDF bytes under any name (a download saved without its extension). */
export function isPdfFile(filePath: string, bytes: Uint8Array): boolean {
  if (path.extname(filePath).toLowerCase() === '.pdf') return true;
  return Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString('latin1') === PDF_MAGIC;
}

/** The line in front of each page's text, so a model can say which page a figure came from. */
export function pdfPageMarker(page: number): string {
  return `--- page ${page} ---`;
}

// Chromium's PDF writer (what `share` and every "Print to PDF" in a Chromium browser produce) maps
// some CJK glyphs back to the look-alike Kangxi radical code points: 日期 comes out as ⽇期.
// Each of them has a compatibility mapping to the ideograph it stands for; real text practically
// never uses the radicals block, and a model or a later text match reading "⽇" is reading noise.
const KANGXI_RADICALS = /[⼀-⿕]/g;

function cleanPageText(text: string): string {
  return text
    .replace(KANGXI_RADICALS, (radical) => radical.normalize('NFKC'))
    .replace(/\0/g, '')
    .replace(/[^\S\n]+\n/g, '\n')
    .trim();
}

async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : ''))
    .join('');
}

/** pdf.js operators that paint text; `getTextContent` drops what a font cannot map to Unicode. */
async function showsText(page: PDFPageProxy, textOps: ReadonlySet<number>): Promise<boolean> {
  const list = await page.getOperatorList();
  return list.fnArray.some((fn) => textOps.has(fn));
}

/** How many empty pages are asked whether they paint text at all, before calling the file scanned. */
const TEXT_PROBE_PAGES = 3;

function pdfError(err: unknown, name: string): FlowUserError {
  const kind = err instanceof Error ? err.name : '';
  if (kind === 'PasswordException') {
    return new FlowUserError('flow.error.pdfPassword', { name }, `file_read: "${name}" is password-protected; it can't be opened without the password.`);
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new FlowUserError('flow.error.pdfInvalid', { name }, `file_read: "${name}" is not a readable PDF (${detail}).`);
}

/**
 * The text of a PDF, page by page, each page after its `--- page N ---` line. A file that paints
 * no text at all is a scan and says so; it never comes back as an empty string a later step
 * would take for an empty document.
 */
export async function readPdfText(bytes: Uint8Array, name: string, limits: PdfLimits = PDF_LIMITS): Promise<string> {
  // Lazy: pdf.js is ~1.6 MB of JavaScript that no boot path needs.
  const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
  let pdf: PDFDocumentProxy;
  try {
    // A copy, because pdf.js takes ownership of (detaches) the buffer it is given. Errors only:
    // its warnings (missing cMaps, font substitution) are about the file, not about Yobi. Only the
    // text is wanted, so fonts are never turned into font faces.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0, disableFontFace: true });
  } catch (err) {
    throw pdfError(err, name);
  }
  try {
    const total = pdf.numPages;
    const sections: string[] = [];
    const emptyPages: number[] = [];
    let chars = 0;
    let lastPage = 0;
    let cut = false;
    for (let n = 1; n <= Math.min(total, limits.maxPages); n++) {
      const page = await pdf.getPage(n);
      let text = cleanPageText(await pageText(page));
      page.cleanup();
      if (!text) emptyPages.push(n);
      if (chars + text.length > limits.maxChars) {
        text = text.slice(0, Math.max(0, limits.maxChars - chars)).trimEnd();
        cut = true;
      }
      chars += text.length;
      lastPage = n;
      sections.push(text ? `${pdfPageMarker(n)}\n${text}` : pdfPageMarker(n));
      if (cut) break;
      // Let IPC and timers in between pages; each page is parsed synchronously.
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (chars === 0) {
      const { OPS } = await getResolvedPDFJS();
      const textOps = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
      for (const n of emptyPages.slice(0, TEXT_PROBE_PAGES)) {
        if (await showsText(await pdf.getPage(n), textOps)) {
          throw new FlowUserError('flow.error.pdfFontUnreadable', { name }, `file_read: "${name}" draws its text with fonts that carry no character mapping, so the text can't be read.`);
        }
      }
      throw new FlowUserError('flow.error.pdfNoText', { name }, `file_read: "${name}" has no text layer — its pages are scanned images, so there is no text to read.`);
    }
    if (cut || lastPage < total) sections.push(`--- truncated: text ends at page ${lastPage} of ${total} ---`);
    return sections.join('\n\n');
  } catch (err) {
    throw err instanceof FlowUserError ? err : pdfError(err, name);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
