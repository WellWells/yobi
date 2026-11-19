import { StoreReadError, type StoreResponse } from './types';

/**
 * Sorts an answer that is not the store's data into why: 401/403/429 and a challenge page are the
 * store refusing this address for now, 5xx is the store being down, anything else unexpected means
 * the endpoint moved. Every kind is passed over by the search; the kind only decides what is said.
 */
export function expectOk(response: StoreResponse): string {
  const { status, text } = response;
  if (status === 401 || status === 403 || status === 429) throw new StoreReadError('refused', `HTTP ${status}`);
  if (status >= 500) throw new StoreReadError('down', `HTTP ${status}`);
  if (status !== 200) throw new StoreReadError('changed', `HTTP ${status}`);
  return text;
}

/** The body as JSON. A page where JSON was due is a wall or an error page: the store refusing. */
export function jsonOf(response: StoreResponse): unknown {
  const text = expectOk(response).trim();
  if (text.startsWith('<')) throw new StoreReadError('refused', 'an HTML page instead of data');
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreReadError('changed', 'the answer is not JSON');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The list at `path`, or a `changed` failure naming the key that is gone. */
export function listAt(root: unknown, path: readonly string[]): Record<string, unknown>[] {
  let node: unknown = root;
  for (const key of path) {
    if (!isRecord(node) || !(key in node)) throw new StoreReadError('changed', `no "${path.join('.')}" in the answer`);
    node = node[key];
  }
  if (!Array.isArray(node)) throw new StoreReadError('changed', `"${path.join('.')}" is not a list`);
  return node.filter(isRecord);
}

/** "$3,254", "3390.0", 979 → the number; NaN when there is none. */
export function amountOf(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const digits = /\d[\d,]*(?:\.\d+)?/.exec(value);
  return digits ? Number(digits[0].replace(/,/g, '')) : Number.NaN;
}

export function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** A list price only when it is above the price: stores repeat the price where nothing is crossed out. */
export function listPriceOf(value: unknown, price: number): { listPrice?: number } {
  const amount = amountOf(value);
  return Number.isFinite(amount) && amount > price ? { listPrice: amount } : {};
}
