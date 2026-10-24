/**
 * Presses on Telegram inline buttons. A button's `callback_data` is `<prefix>:<payload>`; each
 * feature registers its own prefix and gets the payload of its buttons, so a new kind of button
 * adds a handler instead of another `if` in a chain (the LINE side is `line/postbackRouter.ts`).
 *
 * The data comes back from the pressing client as it likes: a handler checks who pressed and what
 * the payload names every time. A press nobody handles still gets an answer, or the client keeps
 * its spinner on the button for a quarter of a minute.
 */
import type { TelegramContext } from './commandHandlers';

/** Telegram's limit on `callback_data`, in bytes. */
export const TELEGRAM_CALLBACK_DATA_MAX = 64;

const PREFIX_PATTERN = /^[a-z][a-z0-9]{0,7}$/;

/** Handles one press; `payload` is the data after `<prefix>:`. */
export type TelegramCallbackHandler = (ctx: TelegramContext, payload: string) => Promise<void>;

/** A button's data for this prefix; throws for anything Telegram would refuse, so no dead button is sent. */
export function telegramCallbackData(prefix: string, payload: string): string {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid Telegram callback prefix: ${prefix}`);
  const data = `${prefix}:${payload}`;
  if (Buffer.byteLength(data, 'utf8') > TELEGRAM_CALLBACK_DATA_MAX) {
    throw new Error(`Telegram callback data over ${TELEGRAM_CALLBACK_DATA_MAX} bytes`);
  }
  return data;
}

export class TelegramCallbackRouter {
  private readonly handlers = new Map<string, TelegramCallbackHandler>();

  constructor(private readonly onLog: (message: string) => void) {}

  register(prefix: string, handler: TelegramCallbackHandler): void {
    if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid Telegram callback prefix: ${prefix}`);
    if (this.handlers.has(prefix)) throw new Error(`Telegram callback prefix already registered: ${prefix}`);
    this.handlers.set(prefix, handler);
  }

  async dispatch(ctx: TelegramContext): Promise<void> {
    const data = ctx.callbackQuery?.data ?? '';
    const split = data.indexOf(':');
    const prefix = split > 0 ? data.slice(0, split) : '';
    const handler = this.handlers.get(prefix);
    if (!handler) {
      this.onLog(`[telegram] button press with unknown data "${data.slice(0, TELEGRAM_CALLBACK_DATA_MAX)}" — ignored`);
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    try {
      await handler(ctx, data.slice(split + 1));
    } catch (err: unknown) {
      this.onLog(`[telegram] button "${prefix}" failed: ${err instanceof Error ? err.message : String(err)}`);
      await ctx.answerCallbackQuery().catch(() => undefined);
    }
  }
}
