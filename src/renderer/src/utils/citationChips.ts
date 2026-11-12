import type { Element, ElementContent, Root, RootContent } from 'hast';
import { isCitationLabel } from '../../../shared/citations';
import { isHttpUrl } from '../../../shared/webUrl';

/** The element a run of citations becomes; Markdown cannot write one itself, raw HTML never reaches the page. */
export const CITATION_RUN_TAG = 'cite';
export const CITATION_RUN_CLASS = 'md-cite-run';

type Parent = Root | Element;

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  return node.children.map(textOf).join('');
}

/** The link itself when `node` is a citation (`[1]` pointing at a web page), else null. */
function citationLink(node: RootContent | undefined): Element | null {
  if (node?.type !== 'element' || node.tagName !== 'a') return null;
  const href = node.properties.href;
  return typeof href === 'string' && isHttpUrl(href) && isCitationLabel(textOf(node)) ? node : null;
}

function isBlank(node: RootContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

/** Wraps each run of citation links — side by side, or apart by whitespace only — in one element. */
function wrapRuns(parent: Parent): void {
  const out: RootContent[] = [];
  const children = parent.children as RootContent[];
  let index = 0;
  while (index < children.length) {
    const node = children[index];
    const link = citationLink(node);
    if (!link) {
      if (node.type === 'element') wrapRuns(node);
      out.push(node);
      index += 1;
      continue;
    }
    const run: Element[] = [link];
    let next = index + 1;
    while (next < children.length) {
      let probe = next;
      while (probe < children.length && isBlank(children[probe])) probe += 1;
      const candidate = citationLink(children[probe]);
      if (!candidate) break;
      run.push(candidate);
      next = probe + 1;
    }
    const hrefs = run.map((link) => String(link.properties.href));
    const text = run.map((link) => textOf(link)).join('');
    out.push({
      type: 'element',
      tagName: CITATION_RUN_TAG,
      properties: { className: [CITATION_RUN_CLASS], dataHrefs: hrefs.join('\n'), dataText: text },
      children: run,
    });
    index = next;
  }
  parent.children = out as typeof parent.children;
}

/** Chat answers only (`citationChips`): exports and every other surface keep plain links. */
export function rehypeCitationChips() {
  return (tree: Root): void => wrapRuns(tree);
}
