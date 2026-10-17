/**
 * 32-bit FNV-1a over the string's UTF-16 code units, as 8 hex digits. Synchronous and the same in
 * main and the renderer (no `node:crypto` there, and `crypto.subtle` is async). A fingerprint for
 * "has this text changed", not a security hash.
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
