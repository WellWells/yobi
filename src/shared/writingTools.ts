/**
 * Writing tools: a one-off request that reworks a passage the user selected in an answer. It never
 * goes through the chat send (no answer preferences, no reply-language rule, no memory or recap) and
 * nothing is written into the conversation; the renderer decides what to do with the result.
 */

export const WRITING_ACTIONS = [
  'proofread', 'rewrite', 'friendly', 'professional', 'concise',
  'summary', 'keyPoints', 'list', 'table', 'custom',
] as const;

export type WritingAction = (typeof WRITING_ACTIONS)[number];

const RESHAPES: ReadonlySet<WritingAction> = new Set(['summary', 'keyPoints', 'list', 'table']);

/** Makes a block of its own (a summary, a list, a table) instead of a passage that goes back in place. */
export function isReshape(action: WritingAction): boolean {
  return RESHAPES.has(action);
}

export interface WritingToolsRequest {
  /** Chosen by the renderer; progress events and cancel name the request by it. */
  id: string;
  providerUrl: string;
  action: WritingAction;
  text: string;
  /** What the user typed for `custom`; ignored by the other actions. */
  instruction?: string;
  /** Where the passage sits, so the rewrite keeps its meaning and reads right in place. */
  context?: WritingContext;
}

/**
 * The text around a passage. `before`/`after` are the answer right before and after it; when the
 * selection could not be traced to the answer's source, `around` is the paragraph it was found in.
 */
export interface WritingContext {
  /** The user's question the answer replied to. */
  question?: string;
  before?: string;
  after?: string;
  around?: string;
}

/**
 * The whole answer goes along; only an answer past this is cut before it reaches main (each part
 * from the side away from the passage). The prompt trims further to fit the provider.
 */
export const WRITING_CONTEXT_MAX_CHARS = 60_000;

export type WritingToolsFailure = 'cancelled' | 'tooLong' | 'empty' | 'failed' | 'invalid';

export type WritingToolsResult =
  | { ok: true; text: string; providerUrl: string }
  | { ok: false; reason: WritingToolsFailure; error?: string };

/** `waiting`: queued behind another AI request in the browser window. */
export interface WritingToolsProgress {
  id: string;
  phase: 'waiting' | 'running';
}

/** A selection longer than this is not a passage to rework; the provider limit usually bites first. */
export const WRITING_TEXT_MAX_CHARS = 60_000;
export const WRITING_INSTRUCTION_MAX_CHARS = 1_000;

export function isWritingAction(value: unknown): value is WritingAction {
  return typeof value === 'string' && (WRITING_ACTIONS as readonly string[]).includes(value);
}

/** The renderer's request, or null when any field is off. */
export function parseWritingToolsRequest(value: unknown): WritingToolsRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { id, providerUrl, action, text, instruction } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || id.length > 100) return null;
  if (typeof providerUrl !== 'string' || !providerUrl.trim()) return null;
  if (!isWritingAction(action)) return null;
  if (typeof text !== 'string' || !text.trim() || text.length > WRITING_TEXT_MAX_CHARS) return null;
  const typed = typeof instruction === 'string' ? instruction.trim() : '';
  if (typed.length > WRITING_INSTRUCTION_MAX_CHARS) return null;
  if (action === 'custom' && !typed) return null;
  const context = parseWritingContext((value as Record<string, unknown>).context);
  return {
    id,
    providerUrl: providerUrl.trim(),
    action,
    text,
    ...(action === 'custom' ? { instruction: typed } : {}),
    ...(context ? { context } : {}),
  };
}

/**
 * Each part a string, cut to the cap from the side away from the passage; null when nothing is
 * left. Not trimmed: whether the passage's line goes on past it decides how its edges are matched.
 */
function parseWritingContext(value: unknown): WritingContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const take = (key: keyof WritingContext, keepEnd: boolean): Partial<WritingContext> => {
    const text = typeof raw[key] === 'string' ? (raw[key] as string) : '';
    if (!text.trim()) return {};
    const cut = text.length > WRITING_CONTEXT_MAX_CHARS
      ? (keepEnd ? text.slice(-WRITING_CONTEXT_MAX_CHARS) : text.slice(0, WRITING_CONTEXT_MAX_CHARS))
      : text;
    return { [key]: cut };
  };
  const context: WritingContext = {
    ...take('question', false),
    ...take('before', true),
    ...take('after', false),
    ...take('around', false),
  };
  return Object.keys(context).length > 0 ? context : null;
}
