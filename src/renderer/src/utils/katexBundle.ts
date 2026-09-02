import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/**
 * Split into its own chunk on purpose. KaTeX is ~500 KB of JS plus its
 * stylesheet, and pulling it from a module the chat view imports statically put
 * all of it on the first-paint critical path for every session — including the
 * overwhelming majority that never render a formula. Reached only through
 * `loadKatex()` in katexRuntime.
 */
export const katexRehypePlugins = [rehypeKatex];
