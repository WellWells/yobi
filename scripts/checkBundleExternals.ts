/*
 * The packaged app ships no node_modules beyond its native modules, so every module the main and
 * preload bundles still load at run time has to be one Node or Electron provides. A dependency's
 * deep import left outside the bundle (`punycode/punycode.es6.js`, kept out because `punycode` is
 * also a built-in name) resolves fine in a checkout, where node_modules sits above `out/`, and
 * stops the installed app at its first line. Run after `build:compile`, before electron-builder.
 *
 *   tsx scripts/checkBundleExternals.ts [dir …]   (default: out/main out/preload)
 *
 * Only real calls count: require(), import() and import/export declarations with a literal name,
 * read from the parsed bundle — not comments, not strings that generated code writes. A require
 * inside a try block is a dependency probing for something optional and is left alone.
 */
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { parseAst } from 'vite';

/** What the packaged app can load besides its own files: Node, Electron, and the native modules it ships. */
export const PACKAGED_MODULES: ReadonlySet<string> = new Set([
  'electron',
  'better-sqlite3-multiple-ciphers',
  'koffi',
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

interface AstNode {
  type: string;
  [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

function literalName(node: unknown): string | null {
  return isNode(node) && node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function isBare(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('/') && !/^[a-z]:[\\/]/i.test(name) && !/^[a-z]+:\/\//i.test(name);
}

/** The module names a bundle loads at run time that the packaged app would not find. */
export function unresolvableModules(source: string, packaged: ReadonlySet<string> = PACKAGED_MODULES): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, inTry: boolean): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, inTry);
      return;
    }
    if (!isNode(node)) return;
    let name: string | null = null;
    if (node.type === 'CallExpression' && isNode(node.callee) && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      name = inTry ? null : literalName((node.arguments as unknown[])[0]);
    } else if (node.type === 'ImportExpression') {
      name = inTry ? null : literalName(node.source);
    } else if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      name = literalName(node.source);
    }
    if (name && isBare(name) && !packaged.has(name)) found.add(name);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'type') continue;
      visit(child, inTry || (node.type === 'TryStatement' && key === 'block'));
    }
  };
  visit(parseAst(source), false);
  return [...found].sort();
}

function bundleFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist: run build:compile first`);
  return fs.readdirSync(dir).filter((name) => /\.(c?js|mjs)$/.test(name)).map((name) => path.join(dir, name));
}

function main(): void {
  const dirs = process.argv.slice(2);
  const problems: string[] = [];
  for (const dir of dirs.length > 0 ? dirs : ['out/main', 'out/preload']) {
    for (const file of bundleFiles(dir)) {
      for (const name of unresolvableModules(fs.readFileSync(file, 'utf8'))) problems.push(`${name}  (${file})`);
    }
  }
  if (problems.length > 0) {
    console.error('The packaged app could not load these modules (bundle them, or ship them as native modules):');
    for (const line of problems) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log('Bundle externals: every runtime module is one the packaged app provides.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
