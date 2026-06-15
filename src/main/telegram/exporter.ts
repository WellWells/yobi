import type { TelegramReplyTarget } from '../../shared/types';

const TELEGRAM_EXPORT_TTL_MS = 30 * 60 * 1000;
export const TELEGRAM_EXPORT_CB_PREFIX = 'expdl';

export type TelegramExportFormat = 'png' | 'webp' | 'pdf';

export type TelegramExportContext = {
  command: TelegramReplyTarget['command'];
  chatId: number;
  userId: number;
  providerLabel: string;
  savedFileName: string;
  prompt: string;
  response: string;
  title: string;
};

export type TelegramExportRecord = TelegramExportContext & {
  token: string;
  createdAt: number;
};

export class ExportTokenRegistry {
  private readonly records = new Map<string, TelegramExportRecord>();
  private readonly TTL_MS = TELEGRAM_EXPORT_TTL_MS;
  private readonly MAX_RECORDS = 200;
  private readonly ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly PRUNE_INTERVAL_MS = 10 * 60_000;

  startPeriodicPrune(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => this.prune(), ExportTokenRegistry.PRUNE_INTERVAL_MS);
  }

  stopPeriodicPrune(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  issue(data: Omit<TelegramExportRecord, 'token' | 'createdAt'>): string {
    this.prune();
    if (this.records.size >= this.MAX_RECORDS) {
      const entries = [...this.records.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      const toRemove = entries.slice(0, this.records.size - this.MAX_RECORDS + 1);
      for (const [key] of toRemove) this.records.delete(key);
    }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      let token = '';
      for (let i = 0; i < 10; i += 1) {
        token += this.ALPHABET[Math.floor(Math.random() * this.ALPHABET.length)];
      }
      if (!this.records.has(token)) {
        this.records.set(token, { ...data, token, createdAt: Date.now() });
        return token;
      }
    }
    const token = `${Date.now().toString(36).toUpperCase()}`;
    this.records.set(token, { ...data, token, createdAt: Date.now() });
    return token;
  }

  get(token: string): TelegramExportRecord | undefined {
    const record = this.records.get(token);
    if (!record) return undefined;
    if (Date.now() - record.createdAt > this.TTL_MS) {
      this.records.delete(token);
      return undefined;
    }
    return record;
  }

  prune(now: number = Date.now()): void {
    for (const [token, record] of this.records.entries()) {
      if (now - record.createdAt > this.TTL_MS) this.records.delete(token);
    }
  }

  clear(): void {
    this.stopPeriodicPrune();
    this.records.clear();
  }
}

export function buildExportCallbackData(token: string, format: TelegramExportFormat): string {
  return `${TELEGRAM_EXPORT_CB_PREFIX}:${token}:${format}`;
}

export function parseExportCallbackData(data: string): { token: string; format: TelegramExportFormat } | null {
  const escapedPrefix = TELEGRAM_EXPORT_CB_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = data.match(new RegExp(`^${escapedPrefix}:([A-Z0-9]+):(png|webp|pdf)$`, 'i'));
  if (!match) return null;
  const token = match[1].toUpperCase();
  const format = match[2].toLowerCase() as TelegramExportFormat;
  return { token, format };
}
