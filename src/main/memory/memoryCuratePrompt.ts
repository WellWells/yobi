import { fenceUntrusted } from '../../shared/promptFencing';
import type { MemoryCurateChange } from '../../shared/memoryCurate';
import type { UserMemoryEntry } from '../../shared/userMemory';
import { MEMORY_ENTRY_MAX_CHARS } from '../../shared/userMemory';

/** What the repair prompt quotes back of a rejected reply. */
const REJECTED_QUOTE_MAX_CHARS = 2_000;

export interface CuratePromptInput {
  entries: readonly UserMemoryEntry[];
  /** `YYYY-MM-DD` in the user's time zone: without it "next week" can never be seen to have passed. */
  today: string;
  /** The language the reasons are written in — the app's, since the user reads them there. */
  language: string;
  instruction?: string;
  /** The proposal the user is commenting on in `feedback`. */
  previous?: readonly MemoryCurateChange[];
  feedback?: string;
  /** A reply that could not be used, and why — for the repair attempt. */
  rejected?: { raw: string; error: string };
}

/** The day an entry was last written, or nothing when the file never recorded it. */
function entryDate(entry: UserMemoryEntry): string {
  const time = Date.parse(entry.updatedAt);
  return Number.isFinite(time) && time > 0 ? entry.updatedAt.slice(0, 10) : 'date unknown';
}

function previousJson(changes: readonly MemoryCurateChange[]): string {
  return JSON.stringify({
    changes: changes.map((change) => ({
      op: change.op,
      ids: change.ids,
      ...(change.text ? { text: change.text } : {}),
      why: change.why,
      sure: change.sure,
    })),
  });
}

/**
 * One prompt, one answer: the whole memory fits, and there is nothing to look up. The model only
 * proposes; every change it names is shown to the user, who picks what happens.
 */
export function buildCuratePrompt(input: CuratePromptInput): string {
  const request = [input.instruction?.trim(), input.feedback?.trim()].filter(Boolean).join('\n');
  const lines = input.entries.map((entry) => `[${entry.id}] (${entryDate(entry)}) ${entry.text}`);
  return [
    'You are tidying the saved memory an assistant keeps about the user.',
    `Today is ${input.today}. Each entry shows its id and the date it was last written.`,
    '',
    'GOAL: fewer, clearer entries that together still say everything that is true about the user today.',
    '',
    'CHANGES YOU CAN PROPOSE:',
    '- merge: two or more entries about the same thing become one sentence.',
    '- rewrite: one entry that is wordy, vague, or corrected by a newer entry.',
    '- remove: an entry past its date (a trip, a deadline, "this week"), replaced by a newer entry, or already said by another.',
    '',
    'RULES:',
    '- Never add a fact that is not in the entries; a merge keeps every detail that is still true.',
    '- Merge only entries on the same topic; never merge just to have fewer entries.',
    '- A merge lists in "ids" every entry whose facts end up in its text, or that entry stays behind as a duplicate.',
    '- When two entries disagree, the newer one wins.',
    '- Set "sure": false when you only suspect an entry is out of date; the user decides.',
    `- One sentence per entry, at most ${MEMORY_ENTRY_MAX_CHARS} characters, in the language the entry is written in.`,
    '- An id may appear in only one change. Anything you leave out stays as it is.',
    '- Leave an entry alone when it is already short and clear; an empty list is a fine answer.',
    `- "why" is one short sentence for the user, written in ${input.language}; the user never sees ids, so name no id in it.`,
    '',
    'OUTPUT RULES (critical):',
    'Reply with a single JSON object and nothing else:',
    '{"changes":[{"op":"merge","ids":["m3","m12"],"text":"...","why":"...","sure":true},{"op":"remove","ids":["m9"],"why":"...","sure":false}]}',
    'If nothing needs changing, reply {"changes":[]}.',
    '',
    'SAVED MEMORY:',
    fenceUntrusted('memory', lines.join('\n')),
    ...(input.previous
      ? ['', 'YOUR LAST PROPOSAL (not applied; the user comments on it below):', fenceUntrusted('proposal', previousJson(input.previous))]
      : []),
    ...(input.rejected
      ? [
        '',
        `YOUR PREVIOUS REPLY COULD NOT BE USED: ${input.rejected.error}`,
        fenceUntrusted('reply', input.rejected.raw.slice(0, REJECTED_QUOTE_MAX_CHARS)),
        'Answer again, following OUTPUT RULES (critical).',
      ]
      : []),
    ...(request ? ['', 'USER REQUEST:', request] : []),
  ].join('\n');
}
