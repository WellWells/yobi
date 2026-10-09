import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import type { Element, ElementContent, Root } from 'hast';
import 'katex/dist/katex.min.css';

const LATEX_FENCE_LANGUAGES = new Set(['latex', 'tex']);

function fenceLanguage(code: Element): string {
  const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
  const tag = classes.map(String).find((name) => name.startsWith('language-'));
  return tag?.slice('language-'.length).toLowerCase() ?? '';
}

function textOf(node: Element): string {
  return node.children
    .map((child: ElementContent) => {
      if (child.type === 'text') return child.value;
      return child.type === 'element' ? textOf(child) : '';
    })
    .join('');
}

function isFormula(tex: string): boolean {
  if (!tex.trim()) return false;
  try {
    katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function retagFormulaFences(node: Root | Element): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    const code = child.tagName === 'pre' ? child.children.find((c): c is Element => c.type === 'element') : undefined;
    if (code?.tagName === 'code' && LATEX_FENCE_LANGUAGES.has(fenceLanguage(code)) && isFormula(textOf(code))) {
      code.properties.className = ['language-math'];
      continue;
    }
    retagFormulaFences(child);
  }
}

/**
 * Hands a ```latex / ```tex fence to rehype-katex as display math, but only when KaTeX can parse
 * it (rehype-katex only recognises ```math). Whole LaTeX documents fail the parse and stay code.
 */
function rehypeLatexFences() {
  return (tree: Root): void => { retagFormulaFences(tree); };
}

/**
 * Its own chunk: KaTeX is ~500 KB of JS plus CSS and most sessions never render a formula.
 * Reached only through `loadKatex()` in katexRuntime.
 */
export const katexRehypePlugins = [rehypeLatexFences, rehypeKatex];
