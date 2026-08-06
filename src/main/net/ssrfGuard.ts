import * as dns from 'node:dns/promises';
import * as net from 'node:net';

function ipv6ToHextets(ip: string): number[] | null {
  if (ip.includes('.')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  let parts: string[];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    parts = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    parts = ip.split(':');
  }
  if (parts.length !== 8) return null;
  return parts.map((h) => parseInt(h || '0', 16));
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isBlockedAddress(dotted[1]);
    const hextets = ipv6ToHextets(lower);
    if (hextets) {
      const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
      const compat = hextets.slice(0, 6).every((h) => h === 0);
      if (mapped || compat) {
        const [h6, h7] = [hextets[6], hextets[7]];
        return isBlockedAddress(`${(h6 >> 8) & 0xff}.${h6 & 0xff}.${(h7 >> 8) & 0xff}.${h7 & 0xff}`);
      }
    }
    return false;
  }
  return false;
}

const MAX_GUARDED_REDIRECTS = 5;

export async function guardedFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let url = typeof input === 'string' ? input : input.toString();
  for (let hop = 0; hop <= MAX_GUARDED_REDIRECTS; hop++) {
    await assertPublicHttpUrl(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    url = new URL(location, url).toString();
  }
  throw new Error('Too many redirects');
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error(`blocked address: ${host}`);
    return u;
  }
  const resolved = await dns.lookup(host, { all: true });
  if (resolved.length === 0) throw new Error(`could not resolve host: ${host}`);
  for (const { address } of resolved) {
    if (isBlockedAddress(address)) throw new Error(`host resolves to a blocked address: ${host} → ${address}`);
  }
  return u;
}
