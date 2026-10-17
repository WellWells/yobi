/**
 * The two values my.telegram.org gives for big Telegram uploads, checked the same way by the
 * settings form (to say what is wrong before saving) and by main (which trusts nothing typed).
 */

/** api_id: digits only. Returns 0 when it is not one. */
export function parseTelegramApiId(text: string): number {
  const trimmed = text.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return 0;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** api_hash: 32 hexadecimal characters. */
export function isTelegramApiHash(text: string): boolean {
  return /^[0-9a-f]{32}$/i.test(text.trim());
}

export interface TelegramLargeUploadSnapshot {
  /** 0 = not set. Not a secret: shown in full. */
  apiId: number;
  hasApiHash: boolean;
  apiHashPreview: string;
}

/** What the form sends. An empty `apiHash` keeps the saved one (the field is cleared after saving). */
export interface TelegramLargeUploadInput {
  apiId: string;
  apiHash: string;
}

export interface TelegramLargeUploadResult {
  ok: boolean;
  /** Set on a successful Test: the bot that signed in. */
  botUsername?: string;
  /** Localized, when `ok` is false. */
  message?: string;
}
