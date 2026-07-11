import { safeStorage } from 'electron';

const ENCRYPTED_PREFIX = 'enc:v1:';

export function encryptToken(token: string): string {
  if (!token) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return ENCRYPTED_PREFIX + safeStorage.encryptString(token).toString('base64');
  }
  console.warn('[config] safeStorage unavailable — secret stored as plaintext. Install libsecret on Linux to enable OS-level encryption.');
  return token;
}

// `failed` distinguishes "there is a stored ciphertext we could not read right
// now" (transient keychain/DPAPI outage) from "the field is genuinely empty".
// Callers use it to avoid overwriting a real stored secret with '' during an
// outage — see saveConfig's keep-if-blank guards.
export function decryptTokenChecked(stored: string): { value: string; failed: boolean } {
  if (!stored) return { value: '', failed: false };
  if (stored.startsWith(ENCRYPTED_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[config] safeStorage unavailable — cannot decrypt stored token. Install libsecret on Linux or check OS keychain access.');
      return { value: '', failed: true };
    }
    try {
      return { value: safeStorage.decryptString(Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), 'base64')), failed: false };
    } catch {
      console.warn('[config] Failed to decrypt token — OS keychain may have changed. Token will be inaccessible until re-entered.');
      return { value: '', failed: true };
    }
  }
  return { value: stored, failed: false };
}

export function decryptToken(stored: string): string {
  return decryptTokenChecked(stored).value;
}
