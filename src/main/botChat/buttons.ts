import { randomBytes } from 'node:crypto';

/**
 * What a button the bot sent stands for, kept here so its data carries only a random code (and a
 * choice's index): nothing a client sends back is trusted as the text to act on. Two kinds:
 *
 * - a question's choices (`registerChoices`): a press answers that question with the choice's
 *   text, as typing it would — only for the person asked, in that chat, while that question is
 *   still the one waiting (`pendingRunId`);
 * - a menu's lines (`registerLine`): a press is that line typed to the bot (a link, a command).
 *
 * In memory only: after a restart a press finds nothing and is told the button has expired.
 */

const MAX_ENTRIES = 500;

function newToken(): string {
  return randomBytes(6).toString('base64url');
}

interface ChoiceEntry {
  chatKey: string;
  runId: string;
  choices: string[];
}

export type ChoicePress =
  | { kind: 'answer'; text: string; choices: string[] }
  /** Someone else's question (another person, or another chat): it may still be waiting for them. */
  | { kind: 'notYours' }
  /** Already answered or replaced, no such choice, or expired. */
  | { kind: 'stale' };

export interface BotButtonRegistry {
  registerChoices: (chatKey: string, runId: string, choices: readonly string[]) => string;
  pressChoice: (token: string, index: number, chatKey: string, pendingRunId: string | null) => ChoicePress;
  registerLine: (line: string) => string;
  lineOf: (token: string) => string | null;
  clear: () => void;
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value);
  // Oldest first: a Map iterates in insertion order.
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
}

export function createBotButtonRegistry(): BotButtonRegistry {
  const choices = new Map<string, ChoiceEntry>();
  const lines = new Map<string, string>();
  return {
    registerChoices: (chatKey, runId, list) => {
      const token = newToken();
      remember(choices, token, { chatKey, runId, choices: [...list] });
      return token;
    },
    pressChoice: (token, index, chatKey, pendingRunId) => {
      const entry = choices.get(token);
      const text = entry?.choices[index];
      if (!entry) return { kind: 'stale' };
      if (entry.chatKey !== chatKey) return { kind: 'notYours' };
      if (text === undefined || entry.runId !== pendingRunId) return { kind: 'stale' };
      return { kind: 'answer', text, choices: entry.choices };
    },
    registerLine: (line) => {
      const token = newToken();
      remember(lines, token, line);
      return token;
    },
    lineOf: (token) => lines.get(token) ?? null,
    clear: () => {
      choices.clear();
      lines.clear();
    },
  };
}

/** `<prefix>:<token>[:<index>]`, the data a button carries back. */
export function buttonData(prefix: string, token: string, index?: number): string {
  return index === undefined ? `${prefix}:${token}` : `${prefix}:${token}:${index}`;
}

export function parseButtonData(data: string): { prefix: string; token: string; index?: number } | null {
  const match = /^([a-z]{2,8}):([A-Za-z0-9_-]{4,32})(?::(\d{1,2}))?$/.exec(data);
  if (!match) return null;
  return { prefix: match[1]!, token: match[2]!, ...(match[3] !== undefined ? { index: Number(match[3]) } : {}) };
}

export const CHOICE_BUTTON_PREFIX = 'ak';
export const LINE_BUTTON_PREFIX = 'fb';
