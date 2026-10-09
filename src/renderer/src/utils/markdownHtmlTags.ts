import type { Blockquote, Paragraph, Parent, Root, RootContent } from 'mdast';
import type {} from 'mdast-util-to-hast';
import {
  INLINE_HTML_TAGS,
  isBreakTag,
  isOnlyHtmlComments,
  parseBareTag,
} from '../../../shared/markdownHtmlWhitelist';

/**
 * Raw HTML in an answer, rendered without ever reaching a DOM parser.
 *
 * There is no `rehype-raw`: provider answers are untrusted, and it would hand them the whole DOM.
 * Instead this rewrites the few raw tags an answer legitimately uses into ordinary markdown nodes
 * whose element name is set by us (`data.hName`) — so the output carries no attribute an answer
 * wrote. Only bare tags count (`markdownHtmlWhitelist`); everything else stays visible text.
 *
 *  - `<br>` becomes a line break (every AI web UI writes a multi-line table cell that way).
 *  - `<kbd>`, `<sub>`, `<sup>`, `<mark>`, `<u>`, `<ins>`, `<s>` with a matching close tag at the
 *    same level become that element.
 *  - `<details>` with an optional `<summary>` becomes a collapsible section. Markdown between
 *    blank lines inside it is parsed as usual; text in the same HTML block as the tags (CommonMark
 *    does not parse there) is kept as plain text.
 *  - A comment disappears.
 */

type Node = RootContent;

const DETAILS_OPEN = /^<details\s*>\s*(?:<summary\s*>([\s\S]*?)<\/summary\s*>)?([\s\S]*)$/i;
const DETAILS_CLOSE = /<\/details\s*>\s*$/i;
const SUMMARY = /^<summary\s*>([\s\S]*?)<\/summary\s*>$/i;

function isHtml(node: Node | undefined, test: (value: string) => boolean): boolean {
  return node?.type === 'html' && test(node.value);
}

function textParagraph(value: string): Paragraph[] {
  const text = value.trim();
  return text ? [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] : [];
}

/** The close tag that matches the open tag at `start`, counting nested ones of the same name. */
function findClose(nodes: readonly Node[], start: number, name: string): number {
  let depth = 0;
  for (let i = start; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type !== 'html') continue;
    const tag = parseBareTag(node.value);
    if (tag?.name !== name) continue;
    depth += tag.closing ? -1 : 1;
    if (depth === 0) return i;
  }
  return -1;
}

function wrapInlineTags(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const tag = node.type === 'html' ? parseBareTag(node.value) : null;
    const close = tag && !tag.closing && INLINE_HTML_TAGS.has(tag.name) ? findClose(nodes, i, tag.name) : -1;
    if (!tag || close < 0) {
      out.push(node);
      continue;
    }
    // An emphasis node renders as its children; `hName` makes the element ours.
    out.push({
      type: 'emphasis',
      data: { hName: tag.name },
      children: wrapInlineTags(nodes.slice(i + 1, close)) as never,
    });
    i = close;
  }
  return out;
}

interface DetailsOpen {
  summary: string | undefined;
  body: string;
  closed: boolean;
}

function parseDetailsOpen(node: Node): DetailsOpen | null {
  if (node.type !== 'html') return null;
  const match = DETAILS_OPEN.exec(node.value.trim());
  if (!match) return null;
  const rest = match[2];
  const closed = DETAILS_CLOSE.test(rest);
  return { summary: match[1], body: closed ? rest.replace(DETAILS_CLOSE, '') : rest, closed };
}

/** The sibling that closes the `<details>` opened at `start`, or -1. */
function findDetailsClose(nodes: readonly Node[], start: number): number {
  let depth = 1;
  for (let i = start + 1; i < nodes.length; i++) {
    const opener = parseDetailsOpen(nodes[i]);
    if (opener && !opener.closed) depth += 1;
    if (!opener && isHtml(nodes[i], (value) => DETAILS_CLOSE.test(value))) depth -= 1;
    if (depth === 0) return i;
  }
  return -1;
}

function detailsNode(open: DetailsOpen, inner: Node[], trailing: string): Blockquote {
  const summary: Paragraph[] = open.summary === undefined
    ? []
    : [{ type: 'paragraph', data: { hName: 'summary' }, children: [{ type: 'text', value: open.summary.trim() }] }];
  return {
    type: 'blockquote',
    data: { hName: 'details', hProperties: { className: ['md-details'] } },
    children: [...summary, ...textParagraph(open.body), ...inner, ...textParagraph(trailing)] as Blockquote['children'],
  };
}

function wrapDetails(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const open = parseDetailsOpen(nodes[i]);
    if (!open) {
      out.push(nodes[i]);
      continue;
    }
    if (open.closed) {
      out.push(detailsNode(open, [], ''));
      continue;
    }
    const close = findDetailsClose(nodes, i);
    if (close < 0) {
      out.push(nodes[i]);
      continue;
    }
    const closer = nodes[close];
    const trailing = closer.type === 'html' ? closer.value.replace(DETAILS_CLOSE, '') : '';
    const inner = nodes.slice(i + 1, close);
    // A blank line after `<details>` puts the `<summary>` in an HTML block of its own.
    const summary = open.summary === undefined && inner[0]?.type === 'html' ? SUMMARY.exec(inner[0].value.trim()) : null;
    const resolved = summary ? { ...open, summary: summary[1] } : open;
    out.push(detailsNode(resolved, wrapDetails(summary ? inner.slice(1) : inner), trailing));
    i = close;
  }
  return out;
}

/** Parents that hold blocks. A `<details>` written mid-sentence stays text: a block cannot sit in a `<p>`. */
const FLOW_PARENTS: ReadonlySet<string> = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

function rewrite(parent: Parent | Root): void {
  for (const child of parent.children) {
    if ('children' in child) rewrite(child);
  }
  const kept = (parent.children as Node[])
    .filter((node) => !isHtml(node, isOnlyHtmlComments))
    .map((node): Node => (isHtml(node, isBreakTag) ? { type: 'break', position: node.position } : node));
  const blocks = FLOW_PARENTS.has(parent.type) ? wrapDetails(kept) : kept;
  parent.children = wrapInlineTags(blocks) as Parent['children'];
}

export function remarkHtmlTags() {
  return (tree: Root): void => { rewrite(tree); };
}
