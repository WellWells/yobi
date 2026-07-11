import { validateSignature } from '@line/bot-sdk';

// Verify a LINE webhook request. The LINE Platform signs the raw request body
// with the channel secret (HMAC-SHA256 → base64) and sends it in the
// X-Line-Signature header; this recomputes and compares it.
//
// Exported for the test suite: pure, offline, deterministic. The signature must
// be checked against the RAW body bytes — parsing to JSON first changes the
// bytes and breaks the HMAC.
export function verifyLineSignature(
  rawBody: Buffer,
  channelSecret: string,
  signature: string | undefined,
): boolean {
  if (!signature || !channelSecret) return false;
  try {
    return validateSignature(rawBody, channelSecret, signature);
  } catch {
    // A malformed signature header can make the base64 comparison throw — treat
    // any failure as a rejected request rather than surfacing an error.
    return false;
  }
}
