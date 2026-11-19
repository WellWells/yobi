/**
 * Picking values out of JSON a site sent (a page's embedded data, an API answer) without trusting
 * its shape: each helper returns an empty value of the expected type when the field is missing or
 * of another type. The JSON is parsed, never run.
 */

export type Json = Record<string, unknown>;

export function obj(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A finite number; 0 otherwise. A numeric string is not a number here (X's reader has its own). */
export function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * The first object anywhere in `values` (depth-first, `maxDepth` levels at most) that `match`
 * accepts; undefined when none does. For sites that nest the same record at no fixed path.
 */
export function findJson(values: readonly unknown[], match: (node: Json) => boolean, maxDepth = 40): Json | undefined {
  const stack: Array<[unknown, number]> = values.map((value) => [value, 0] as [unknown, number]).reverse();
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (!value || typeof value !== 'object') continue;
    const children = Array.isArray(value) ? value : Object.values(value);
    if (!Array.isArray(value) && match(value as Json)) return value as Json;
    if (depth >= maxDepth) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
  }
  return undefined;
}

/** Every `<script type="application/json">` block. */
const ALL_SCRIPTS_RE = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
/** Only the blocks marked `data-sjs`: where Threads and Instagram put their prefetched query results. */
const SJS_SCRIPTS_RE = /<script type="application\/json"[^>]*\bdata-sjs\b[^>]*>([\s\S]*?)<\/script>/g;

export interface ScriptJsonOptions {
  /** Only the `data-sjs` blocks (Threads, Instagram); Facebook needs every block. */
  sjsOnly: boolean;
  /** Blocks without this text are skipped before parsing; most blocks are the page's own modules. */
  marker?: string;
}

/**
 * A Google page's data calls (`AF_initDataCallback({key: 'ds:5', hash: '…', data:[…], sideChannel: {}})`,
 * Google Play): the `data` of each, parsed, by key. A call whose data is not JSON is skipped.
 */
const INIT_DATA_RE = /AF_initDataCallback\(\{key: '(ds:\d+)', hash: '[^']*', data:([\s\S]*?), sideChannel: \{\}\}\);<\/script>/g;

export function initDataBlocks(html: string): Map<string, unknown> {
  const blocks = new Map<string, unknown>();
  for (const match of html.matchAll(INIT_DATA_RE)) {
    try {
      blocks.set(match[1], JSON.parse(match[2]));
    } catch {
      // A call whose data is not JSON holds nothing to read.
    }
  }
  return blocks;
}

/** The value at `path` in nested arrays (Google's positional data); undefined when any step is missing. */
export function at(value: unknown, ...path: number[]): unknown {
  let node = value;
  for (const index of path) {
    if (!Array.isArray(node)) return undefined;
    node = node[index];
  }
  return node;
}

/** The page's JSON script blocks, parsed, in page order; a block that is not JSON is skipped. */
export function* scriptJson(html: string, options: ScriptJsonOptions): Generator<unknown> {
  const re = options.sjsOnly ? SJS_SCRIPTS_RE : ALL_SCRIPTS_RE;
  for (const match of html.matchAll(re)) {
    if (options.marker !== undefined && !match[1].includes(options.marker)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      // A block that is not JSON holds nothing to read.
      continue;
    }
    yield parsed;
  }
}
