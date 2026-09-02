import { createBundledHighlighter } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

/**
 * Fine-grained Shiki bundle.
 *
 * The stock `shiki` entry point registers every grammar and theme it ships
 * (~360 languages, 66 themes). Vite emits one lazy chunk per entry, so the
 * renderer carried ~9.5 MB of grammars that were never requested at runtime.
 * This module registers only what Yobi actually highlights.
 *
 * Keys mirror Shiki's own registry: every alias is a separate key so markdown
 * fences such as ```cs, ```yml or ```c++ still resolve. Grammar dependencies
 * (php -> html/xml/sql/javascript/json/css, cpp -> cpp-macro/glsl/regexp) are
 * plain ESM imports inside each language module, so the bundler pulls them in
 * automatically — they must not be listed here.
 */
export const BUNDLED_LANGS = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  'c++': () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  'c#': () => import('@shikijs/langs/csharp'),
  cs: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  dockerfile: () => import('@shikijs/langs/docker'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  gql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  properties: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  js: () => import('@shikijs/langs/javascript'),
  cjs: () => import('@shikijs/langs/javascript'),
  mjs: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  kt: () => import('@shikijs/langs/kotlin'),
  kts: () => import('@shikijs/langs/kotlin'),
  markdown: () => import('@shikijs/langs/markdown'),
  md: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  python: () => import('@shikijs/langs/python'),
  py: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  rs: () => import('@shikijs/langs/rust'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  bash: () => import('@shikijs/langs/shellscript'),
  sh: () => import('@shikijs/langs/shellscript'),
  shell: () => import('@shikijs/langs/shellscript'),
  zsh: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  ts: () => import('@shikijs/langs/typescript'),
  cts: () => import('@shikijs/langs/typescript'),
  mts: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
  yml: () => import('@shikijs/langs/yaml'),
} as const;

/** Every theme referenced by `THEME_DEFS` in `src/shared/themes.ts`. */
export const BUNDLED_THEMES = {
  'catppuccin-latte': () => import('@shikijs/themes/catppuccin-latte'),
  'catppuccin-mocha': () => import('@shikijs/themes/catppuccin-mocha'),
  dracula: () => import('@shikijs/themes/dracula'),
  'everforest-dark': () => import('@shikijs/themes/everforest-dark'),
  'github-dark': () => import('@shikijs/themes/github-dark'),
  'github-dark-high-contrast': () => import('@shikijs/themes/github-dark-high-contrast'),
  'github-light': () => import('@shikijs/themes/github-light'),
  'gruvbox-dark-medium': () => import('@shikijs/themes/gruvbox-dark-medium'),
  monokai: () => import('@shikijs/themes/monokai'),
  nord: () => import('@shikijs/themes/nord'),
  'one-dark-pro': () => import('@shikijs/themes/one-dark-pro'),
  'rose-pine-dawn': () => import('@shikijs/themes/rose-pine-dawn'),
  'solarized-dark': () => import('@shikijs/themes/solarized-dark'),
  'solarized-light': () => import('@shikijs/themes/solarized-light'),
  'synthwave-84': () => import('@shikijs/themes/synthwave-84'),
  'tokyo-night': () => import('@shikijs/themes/tokyo-night'),
} as const;

export type BundledLangName = keyof typeof BUNDLED_LANGS;
export type BundledThemeName = keyof typeof BUNDLED_THEMES;

export const createHighlighter = createBundledHighlighter<BundledLangName, BundledThemeName>({
  langs: BUNDLED_LANGS,
  themes: BUNDLED_THEMES,
  engine: () => createOnigurumaEngine(import('shiki/wasm')),
});

export type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;
