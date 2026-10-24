/**
 * Buttons under a bot run's question (2026-10-19, user: 「如果真的需要確認，我希望能夠提供按鈕在TG上進行」).
 * A question with choices — the model's own, or the program's approval of a shell command or a
 * connector change — gets one button per choice; a press answers with that choice's own text, as
 * if it had been typed, through the same queue. Typing still works. The buttons carry no numbers,
 * so a typed number is not a choice here (`applyAnswer`, 2026-10-20).
 *
 * The run is already paused when the buttons go out, so a press never waits on the run it answers
 * (grammY handles one update at a time). `callback_data` carries only a random token and the
 * choice's position: what the answer says is read from the registry, never from the client.
 */
import { randomBytes } from 'node:crypto';
import { clipLine } from '../../shared/textBudget';
import { t } from '../i18n';
import { telegramCallbackData } from './callbackRouter';
import { flowButtonRows } from './flowButtons';
import type { TelegramContext } from './commandHandlers';

export const ASK_BUTTON_CB_PREFIX = 'ak';

/** The data of the one button a question keeps once answered; pressing it only says so. */
const ANSWERED_PAYLOAD = '-';

/** A question the user never answers is forgotten after this; the pending ask itself expires sooner. */
const ASK_BUTTON_TTL_MS = 24 * 60 * 60_000;

/** Long choices stay whole in the answer; only the button's label is cut. */
const LABEL_MAX = 40;

interface AskButtonRecord {
  runId: string;
  chatId: number;
  userId: number;
  choices: string[];
  createdAt: number;
  /** The message the buttons are on, once sent. */
  messageId?: number;
}

const live = new Map<string, AskButtonRecord>();

type InlineButton = { text: string; callback_data: string };
export type AskKeyboard = { inline_keyboard: InlineButton[][] };

/** A question that stopped waiting while its buttons were on screen. */
export interface RetiredAsk {
  chatId: number;
  messageId: number;
  choices: string[];
}

/** Enough of grammY's `Api` to change a sent message's buttons. */
export interface AskMarkupApi {
  editMessageReplyMarkup: (chatId: number, messageId: number, other: { reply_markup: AskKeyboard }) => Promise<unknown>;
}

function prune(now: number): void {
  for (const [token, record] of live) {
    if (now - record.createdAt > ASK_BUTTON_TTL_MS) live.delete(token);
  }
}

/** One line, cut between whole characters so no emoji is left half on the button. */
function label(choice: string): string {
  return clipLine(choice, LABEL_MAX);
}

/** What an answered question keeps: one "Chosen: …" button that does nothing. */
function chosenKeyboard(strings: Record<string, string>, choice: string): AskKeyboard {
  return {
    inline_keyboard: [[{
      text: t(strings, 'telegram.ask.chosen', { choice: label(choice) }),
      callback_data: telegramCallbackData(ASK_BUTTON_CB_PREFIX, ANSWERED_PAYLOAD),
    }]],
  };
}

/**
 * The keyboard for one question, minted for the person asked in this chat. A newer question to the
 * same person retires the older one's buttons: only the latest question is waiting for an answer.
 */
export function askKeyboard(
  owner: { runId: string; chatId: number; userId: number },
  choices: readonly string[],
  now = Date.now(),
): AskKeyboard {
  prune(now);
  retireAskButtons(owner.chatId, owner.userId);
  const token = randomBytes(12).toString('base64url');
  live.set(token, { ...owner, choices: [...choices], createdAt: now });
  const buttons = choices.map((choice, index) => ({ label: label(choice), index, rowStart: index === 0 }));
  return {
    inline_keyboard: flowButtonRows(buttons).map((row) => row.map((button) => ({
      text: button.label,
      callback_data: telegramCallbackData(ASK_BUTTON_CB_PREFIX, `${token}:${button.index}`),
    }))),
  };
}

/** The question's buttons went out on this message, so they can be taken off it later. */
export function noteAskMessage(chatId: number, userId: number, messageId: number): void {
  for (const record of live.values()) {
    if (record.chatId === chatId && record.userId === userId && record.messageId === undefined) record.messageId = messageId;
  }
}

/**
 * Every button this person has in this chat stops answering: a newer question is waiting, or the
 * last one was answered or dropped. Needed for a question without choices as well — it may come
 * from the same run (a typed answer resumed it), and the run id alone would still match the older
 * question's buttons. `waitingRunId` keeps the buttons of the run whose question still waits (a
 * refused request dropped nothing). Returns the ones on screen, for `clearRetiredButtons`.
 */
export function retireAskButtons(chatId: number, userId: number, waitingRunId?: string): RetiredAsk[] {
  const retired: RetiredAsk[] = [];
  for (const [token, record] of live) {
    if (record.chatId !== chatId || record.userId !== userId || record.runId === waitingRunId) continue;
    live.delete(token);
    if (record.messageId !== undefined) retired.push({ chatId, messageId: record.messageId, choices: record.choices });
  }
  return retired;
}

/**
 * Takes the buttons off questions that stopped waiting, so none still looks answerable (best
 * effort). An answer typed as one of the choices, word for word, leaves the "Chosen: …" a press does.
 */
export async function clearRetiredButtons(
  api: AskMarkupApi | undefined,
  retired: readonly RetiredAsk[],
  strings: Record<string, string>,
  typed?: string,
): Promise<void> {
  if (!api) return;
  await Promise.all(retired.map((ask) => {
    const chosen = typed === undefined ? undefined : ask.choices.find((choice) => choice.trim() === typed.trim());
    const keyboard = chosen === undefined ? { inline_keyboard: [] } : chosenKeyboard(strings, chosen);
    return Promise.resolve()
      .then(() => api.editMessageReplyMarkup(ask.chatId, ask.messageId, { reply_markup: keyboard }))
      .catch(() => undefined);
  }));
}

export function clearAskButtons(): void {
  live.clear();
}

export interface AskButtonDeps {
  getStrings: () => Record<string, string>;
  /** The run whose question this person still has to answer in this chat, or null. */
  pendingRunId: (chatId: number, userId: number) => string | null;
  /** Answers it, as typing `answer` would. */
  answer: (ctx: TelegramContext, answer: string) => Promise<void>;
  onLog: (message: string) => void;
}

async function retireKeyboard(ctx: TelegramContext, keyboard: AskKeyboard): Promise<void> {
  await ctx.editMessageReplyMarkup({ reply_markup: keyboard }).catch(() => undefined);
}

export async function handleAskButton(ctx: TelegramContext, payload: string, deps: AskButtonDeps): Promise<void> {
  const s = deps.getStrings();
  if (payload === ANSWERED_PAYLOAD) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.ask.alreadyAnswered') });
    return;
  }
  const match = /^([\w-]{16}):(\d{1,2})$/.exec(payload);
  const record = match ? live.get(match[1]) : undefined;
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!match || !record || chatId === undefined || userId === undefined) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.ask.expired'), show_alert: true });
    await retireKeyboard(ctx, { inline_keyboard: [] });
    return;
  }
  if (record.chatId !== chatId || record.userId !== userId) {
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.ask.otherUser'), show_alert: true });
    return;
  }
  const choice = record.choices[Number(match[2])];
  // Answered by typing, replaced by a newer question, or past the answer time: not this run's turn.
  if (choice === undefined || deps.pendingRunId(chatId, userId) !== record.runId) {
    live.delete(match[1]);
    await ctx.answerCallbackQuery({ text: t(s, 'telegram.ask.expired'), show_alert: true });
    await retireKeyboard(ctx, { inline_keyboard: [] });
    return;
  }
  // Taken before anything is awaited, so a second press cannot answer twice.
  live.delete(match[1]);
  deps.onLog(`[telegram] question answered with button ${Number(match[2]) + 1} by ${userId}`);
  await ctx.answerCallbackQuery();
  await retireKeyboard(ctx, chosenKeyboard(s, choice));
  // The choice's own text: the buttons show no numbers, so neither does the answer, and a choice
  // that is itself a small number ("2") stays that choice (`applyAnswer`).
  await deps.answer(ctx, choice);
}
