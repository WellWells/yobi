/**
 * OfficeCLI's HTML of a deck is a viewer: a sidebar, a page counter, and one scrolling column whose
 * slides a script scales to the window. Printed as it is, a PDF is one page with scrollbars, a
 * "2 / 3" badge and the last slide cut off. A deck gets print rules first: one slide a
 * page, the page the slide's own size, nothing of the viewer. Documents and workbooks print as they are.
 */
import * as fs from 'node:fs/promises';
import { printHtmlFileToPdf } from './htmlToPdf';

const DESIGN_SIZE = /--slide-design-w:\s*([\d.]+pt)\s*;\s*--slide-design-h:\s*([\d.]+pt)/;

/** The deck's print rules, or the page unchanged when it is not a deck. */
export function deckForPrint(html: string): string {
  if (!html.includes('class="slide-container"')) return html;
  const size = DESIGN_SIZE.exec(html);
  const page = size ? `@page{size:${size[1]} ${size[2]};margin:0}` : '@page{size:A4 landscape;margin:0}';
  const rules = `<style>@media print{${page}`
    + 'html,body{height:auto!important;overflow:visible!important;background:#fff!important;display:block!important}'
    + '.sidebar,.sidebar-toggle,.toggle-zone,.page-counter,.slide-label,.file-title{display:none!important}'
    + '.main{display:block!important;overflow:visible!important;padding:0!important;gap:0!important}'
    + '.slide-container{display:block!important;gap:0!important;break-after:page}'
    + '.slide-container:last-child{break-after:auto}'
    + '.slide-wrapper{display:block!important;height:auto!important}'
    + '.slide{transform:none!important;box-shadow:none!important;border-radius:0!important;margin:0!important}'
    + '.slide-notes{display:none!important}}</style>';
  return html.includes('</head>') ? html.replace('</head>', `${rules}</head>`) : `${rules}${html}`;
}

/** Prints an HTML file OfficeCLI wrote (into a folder of Yobi's own), a deck with its print rules. */
export async function printOfficeHtmlFile(htmlFile: string, signal?: AbortSignal): Promise<Buffer> {
  const html = await fs.readFile(htmlFile, 'utf8');
  const printable = deckForPrint(html);
  if (printable !== html) await fs.writeFile(htmlFile, printable, 'utf8');
  return printHtmlFileToPdf(htmlFile, signal);
}
