import { useEffect, useMemo, useState } from 'react';

export type RehypePluginList = any[];

/**
 * `remarkPlugins` configures remark-math with `singleDollarTextMath: false`, so
 * a lone `$` is never math and `$$` is the only delimiter that can produce a
 * math node for rehype-katex to pick up. Documents without it get no math nodes
 * at all, which is why they can skip the whole bundle rather than just defer it.
 *
 * The other route in is a ```math / ```latex / ```tex fence. The prefix allows any
 * indent and blockquote marker, so a fence nested in a list is never missed; a latex
 * fence that KaTeX then rejects only costs the chunk load.
 */
const MATH_DELIMITER = /\$\$|^[ \t>]*(?:`{3,}|~{3,})[ \t]*(?:math|latex|tex)(?![\w-])/im;

export const NO_KATEX: RehypePluginList = [];

let _plugins: RehypePluginList | null = null;
let _loadPromise: Promise<RehypePluginList> | null = null;

export function hasMath(markdown: string): boolean {
  return MATH_DELIMITER.test(markdown);
}

export function getKatexPluginsSync(): RehypePluginList | null {
  return _plugins;
}

export function loadKatex(): Promise<RehypePluginList> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async (): Promise<RehypePluginList> => {
    try {
      const { katexRehypePlugins } = await import('./katexBundle');
      _plugins = katexRehypePlugins;
    } catch (err) {
      // Never throw: callers fall back to the raw `$$…$$` source, the same way
      // shiki degrades to unhighlighted code.
      console.error('[katex] failed to load', err);
      _plugins = NO_KATEX;
    }
    return _plugins;
  })();
  return _loadPromise;
}

/**
 * Rehype plugins for one markdown source: empty until the document turns out to
 * contain math, then empty again only until the chunk lands and the re-render
 * swaps in the real formula.
 */
export function useKatexPlugins(source: string): RehypePluginList {
  const needsMath = useMemo(() => hasMath(source), [source]);
  const [plugins, setPlugins] = useState<RehypePluginList | null>(getKatexPluginsSync);

  useEffect(() => {
    if (!needsMath || plugins) return;
    let active = true;
    void loadKatex().then((loaded) => {
      if (active) setPlugins(loaded);
    });
    return () => { active = false; };
  }, [needsMath, plugins]);

  return needsMath && plugins ? plugins : NO_KATEX;
}
