import type { Blockquote, Parent, Root } from 'mdast';
import type {} from 'mdast-util-to-hast';
import { ALERT_KINDS, type AlertKind, type MarkdownLabels } from '../../../shared/markdownLabels';

/**
 * GitHub's callouts: a blockquote whose first line is only `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]`. The marker is replaced by a title in the app language and the
 * quote is tagged with its kind for colour. Runs before `remark-breaks`, while the marker and the
 * first line of the body are still one text node.
 */

const MARKER = /^\[!([a-z]+)\][ \t]*(?:\n|$)/i;

function alertKind(value: string): AlertKind | null {
  const kind = MARKER.exec(value)?.[1].toLowerCase();
  return (ALERT_KINDS as readonly string[]).includes(kind ?? '') ? (kind as AlertKind) : null;
}

function convert(quote: Blockquote, labels: MarkdownLabels | null): void {
  const first = quote.children[0];
  if (first?.type !== 'paragraph') return;
  const lead = first.children[0];
  if (lead?.type !== 'text') return;
  const kind = alertKind(lead.value);
  if (!kind) return;

  lead.value = lead.value.replace(MARKER, '');
  if (!lead.value) first.children.shift();
  if (first.children.length === 0) quote.children.shift();
  quote.data = { ...quote.data, hProperties: { className: ['md-alert', `md-alert-${kind}`] } };
  const title = labels?.alerts[kind];
  if (title) {
    quote.children.unshift({
      type: 'paragraph',
      data: { hProperties: { className: ['md-alert-title'] } },
      children: [{ type: 'text', value: title }],
    });
  }
}

function visit(parent: Parent, labels: MarkdownLabels | null): void {
  for (const child of parent.children) {
    if (child.type === 'blockquote') convert(child, labels);
    if ('children' in child) visit(child, labels);
  }
}

export function remarkAlerts(options: { labels: MarkdownLabels | null }) {
  return (tree: Root): void => { visit(tree, options.labels); };
}
