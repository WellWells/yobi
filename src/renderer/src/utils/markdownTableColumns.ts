import type { Element, ElementContent, Root } from 'hast';
import { displayWidth } from './displayWidth';

/**
 * Widest line (in display cells, CJK = 2) a column may hold and still be kept on
 * one line: a status word, a priority, an ISO date or a short amount.
 */
export const TIGHT_COLUMN_MAX_WIDTH = 16;

/**
 * Combined width the kept-on-one-line columns of a single table may claim, so a
 * table of many short columns cannot push past a narrow chat pane or export card.
 */
export const TIGHT_TABLE_BUDGET = 40;

export const TIGHT_CELL_CLASS = 'md-col-tight';

const SECTION_TAGS = new Set(['thead', 'tbody', 'tfoot']);
const CELL_TAGS = new Set(['th', 'td']);

function isElement(node: ElementContent | Root['children'][number]): node is Element {
  return node.type === 'element';
}

function cellText(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (!isElement(node)) return '';
  if (node.tagName === 'br') return '\n';
  return node.children.map(cellText).join('');
}

function widestLine(text: string): number {
  return Math.max(0, ...text.split('\n').map((line) => displayWidth(line.trim())));
}

function tableRows(table: Element): Element[] {
  return table.children.filter(isElement).flatMap((child) => {
    if (child.tagName === 'tr') return [child];
    if (!SECTION_TAGS.has(child.tagName)) return [];
    return child.children.filter(isElement).filter((row) => row.tagName === 'tr');
  });
}

function rowCells(row: Element): Element[] {
  return row.children.filter(isElement).filter((cell) => CELL_TAGS.has(cell.tagName));
}

/**
 * Which columns to keep on one line, given each column's widest line.
 *
 * An auto-layout table squeezes short columns to min-content width when a long column wants the
 * room, and CJK text can break between any two characters, so a short status word or a date wraps.
 * Short columns are kept whole only when a longer column is left to absorb the squeeze; narrowest
 * columns are picked first until the budget runs out.
 */
export function pickTightColumns(widths: readonly number[]): Set<number> {
  const short = widths
    .map((width, index) => ({ width, index }))
    .filter(({ width }) => width <= TIGHT_COLUMN_MAX_WIDTH);
  if (short.length === widths.length) return new Set();
  short.sort((a, b) => a.width - b.width || a.index - b.index);
  const picked = new Set<number>();
  let used = 0;
  for (const { width, index } of short) {
    if (used + width > TIGHT_TABLE_BUDGET) break;
    used += width;
    picked.add(index);
  }
  return picked;
}

function addCellClass(cell: Element): void {
  const current = cell.properties.className;
  const classes = Array.isArray(current) ? current : current ? [String(current)] : [];
  cell.properties.className = [...classes, TIGHT_CELL_CLASS];
}

function markTable(table: Element): void {
  const rows = tableRows(table).map(rowCells);
  const widths: number[] = [];
  for (const cells of rows) {
    cells.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, widestLine(cellText(cell)));
    });
  }
  const tight = pickTightColumns(widths);
  if (tight.size === 0) return;
  for (const cells of rows) {
    cells.forEach((cell, index) => {
      if (tight.has(index)) addCellClass(cell);
    });
  }
}

function visit(node: Root | Element): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tagName === 'table') markTable(child);
    else visit(child);
  }
}

/**
 * Tags every cell of a short column with `md-col-tight` (`white-space: nowrap`
 * in both the chat and the export card stylesheets). Runs before rehype-katex,
 * so a formula is measured by its TeX source.
 */
export function rehypeTightTableColumns() {
  return (tree: Root): void => { visit(tree); };
}
