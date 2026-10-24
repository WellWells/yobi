import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LINE's webhook check: base64 HMAC-SHA256 of the raw body, keyed by the channel secret.
 * Same comparison as @line/bot-sdk's validateSignature (lenient base64 decode, length check
 * before the constant-time compare), without loading the SDK to do it.
 */
export function verifyLineSignature(
  rawBody: Buffer,
  channelSecret: string,
  signature: string | undefined,
): boolean {
  if (typeof signature !== 'string' || !signature || !channelSecret) return false;
  try {
    const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
