import { validateSignature } from '@line/bot-sdk';

export function verifyLineSignature(
  rawBody: Buffer,
  channelSecret: string,
  signature: string | undefined,
): boolean {
  if (!signature || !channelSecret) return false;
  try {
    return validateSignature(rawBody, channelSecret, signature);
  } catch {
    return false;
  }
}
