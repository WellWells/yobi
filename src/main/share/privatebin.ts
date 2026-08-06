import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import { base58Encode } from './base58';
import { guardedFetch } from '../net/ssrfGuard';
import type { ShareErrorCode, ShareExpire } from '../../shared/types';

const KDF_ITERATIONS = 100_000;
const KEY_BITS = 256;
const TAG_BITS = 128;
const PASTE_KEY_BYTES = 32;
const IV_BYTES = 16;
const SALT_BYTES = 8;

const REQUEST_TIMEOUT_MS = 20_000;

export class ShareError extends Error {
  readonly code: ShareErrorCode;
  readonly detail: string;

  constructor(code: ShareErrorCode, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'ShareError';
    this.code = code;
    this.detail = detail;
  }
}

type PasteAdata = [
  [string, string, number, number, number, 'aes', 'gcm', 'zlib'],
  'markdown',
  0,
  0 | 1,
];

export interface PasteBody {
  v: 2;
  ct: string;
  adata: PasteAdata;
  meta: { expire: ShareExpire };
}

export interface PasteEntropy {
  pasteKey: Buffer;
  iv: Buffer;
  salt: Buffer;
}

export interface PasteOptions {
  expire: ShareExpire;
  burnAfterReading: boolean;
}

export function buildPastePayload(
  markdown: string,
  opts: PasteOptions,
  entropy?: PasteEntropy,
): { body: PasteBody; pasteKey: Buffer } {
  const pasteKey = entropy?.pasteKey ?? crypto.randomBytes(PASTE_KEY_BYTES);
  const iv = entropy?.iv ?? crypto.randomBytes(IV_BYTES);
  const salt = entropy?.salt ?? crypto.randomBytes(SALT_BYTES);

  const envelope = Buffer.from(JSON.stringify({ paste: markdown }), 'utf8');
  const compressed = zlib.deflateRawSync(envelope);

  const derivedKey = crypto.pbkdf2Sync(pasteKey, salt, KDF_ITERATIONS, KEY_BITS / 8, 'sha256');

  const adata: PasteAdata = [
    [
      iv.toString('base64'),
      salt.toString('base64'),
      KDF_ITERATIONS,
      KEY_BITS,
      TAG_BITS,
      'aes',
      'gcm',
      'zlib',
    ],
    'markdown',
    0,
    opts.burnAfterReading ? 1 : 0,
  ];

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv, {
    authTagLength: TAG_BITS / 8,
  });
  cipher.setAAD(Buffer.from(JSON.stringify(adata), 'utf8'));
  const ct = Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);

  return {
    body: { v: 2, ct: ct.toString('base64'), adata, meta: { expire: opts.expire } },
    pasteKey,
  };
}

export function normalizeInstanceUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildShareUrl(pasteUrl: string, pasteKey: Buffer): string {
  return `${pasteUrl}#${base58Encode(pasteKey)}`;
}

interface PasteResponse {
  status?: number;
  id?: string;
  url?: string;
  deletetoken?: string;
  message?: string;
}

function requestInit(body?: string): RequestInit {
  return {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'JSONHttpRequest',
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function transportError(err: unknown): ShareError {
  const message = err instanceof Error ? err.message : String(err);
  if (/blocked address|blocked range|unsupported protocol|could not resolve/i.test(message)) {
    return new ShareError('blocked', message);
  }
  return new ShareError('unreachable', message);
}

async function readPasteResponse(res: Response): Promise<PasteResponse> {
  try {
    return await res.json() as PasteResponse;
  } catch {
    throw new ShareError('rejected', `unexpected response from instance (HTTP ${res.status})`);
  }
}

export async function createPaste(
  instanceUrl: string,
  markdown: string,
  opts: PasteOptions,
): Promise<{ url: string; deleteUrl: string }> {
  if (!markdown.trim()) throw new ShareError('empty');

  const base = normalizeInstanceUrl(instanceUrl);
  if (!base) throw new ShareError('blocked', instanceUrl);
  const { body, pasteKey } = buildPastePayload(markdown, opts);

  let res: Response;
  try {
    res = await guardedFetch(`${base}/`, requestInit(JSON.stringify(body)));
  } catch (err) {
    throw transportError(err);
  }

  const json = await readPasteResponse(res);
  if (!res.ok || json.status !== 0 || !json.url) {
    throw new ShareError('rejected', json.message ?? `HTTP ${res.status}`);
  }

  const pasteUrl = new URL(json.url, `${base}/`).toString();
  return {
    url: buildShareUrl(pasteUrl, pasteKey),
    deleteUrl: json.deletetoken
      ? `${pasteUrl}&deletetoken=${encodeURIComponent(json.deletetoken)}`
      : '',
  };
}

export async function revokePaste(instanceUrl: string, deleteUrl: string): Promise<void> {
  const base = normalizeInstanceUrl(instanceUrl);
  if (!base) throw new ShareError('blocked', instanceUrl);
  let target: URL;
  try {
    target = new URL(deleteUrl);
  } catch {
    throw new ShareError('blocked', 'malformed delete URL');
  }
  if (target.origin !== new URL(`${base}/`).origin) {
    throw new ShareError('blocked', 'delete URL does not belong to the configured instance');
  }

  let res: Response;
  try {
    res = await guardedFetch(target.toString(), requestInit());
  } catch (err) {
    throw transportError(err);
  }

  const json = await readPasteResponse(res);
  if (!res.ok || json.status !== 0) {
    throw new ShareError('rejected', json.message ?? `HTTP ${res.status}`);
  }
}
