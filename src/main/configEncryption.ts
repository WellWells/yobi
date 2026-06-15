import { safeStorage } from 'electron';

const ENCRYPTED_PREFIX = 'enc:v1:';

export function encryptToken(token: string): string {
  if (!token) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(token).toString('base64');
  }
  console.warn('[config] safeStorage unavailable — botToken stored as plaintext. Install libsecret on Linux to enable OS-level encryption.');
  return token;
}

export function decryptToken(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[config] safeStorage unavailable — cannot decrypt stored token. Install libsecret on Linux or check OS keychain access.');
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64'));
    } catch {
      console.warn('[config] Failed to decrypt token — OS keychain may have changed. Token will be inaccessible until re-entered.');
      return '';
    }
  }
  return stored;
}
