import { parseUploadFailure } from './providers/fileDrop';
import { getAccountStatus } from './providers/authStatus';
import { withDeferredSignIn } from './deferredSignIn';
import { PROVIDER_LABELS, PROVIDER_URLS, providerFromUrl } from '../shared/types';
import type { Provider, Task } from '../shared/types';
import {
  PROVIDER_FALLBACK_ORDER,
  fallbackCandidates,
  fallbackReasonText,
  webProviderOf,
} from '../shared/providerFallback';
import { fillTemplate } from '../shared/fillTemplate';
import type { ProviderFallbackReason, TurnProviderSwitch } from '../shared/providerFallback';

/**
 * Failures that leave the user with no answer at all, and that another provider does not share:
 * decided before the message reached the provider, or certain that it produced nothing. Only
 * these move a send on. Anything that may still have an answer or a side effect — a timeout while
 * waiting, a send the page never confirmed, a generation that never visibly started — is
 * reported as before, so a message is never answered twice. Matched anywhere in the text, since
 * a page script's error arrives wrapped as "<provider> automation failed: …".
 */
const NO_ANSWER_FAILURES: ReadonlyArray<readonly [RegExp, ProviderFallbackReason]> = [
  // Checked by the runner from the session and the landed page, before anything is typed.
  [/\b(?:CHATGPT|CLAUDE)_LOGIN_REQUIRED\b/, 'signIn'],
  // After the send: Gemini went idle with no answer text and no generation running.
  [/\bGEMINI_LOGIN_REQUIRED\b/, 'signIn'],
  // After the send: the whole reply was Perplexity's "sign up and repeat your request" wall.
  [/^Perplexity asked to sign in$/, 'signIn'],
  // Claude refuses before the send, or rejects the click itself with the upgrade dialog.
  [/\bCLAUDE_USAGE_LIMIT:/, 'limit'],
  // After the send: Claude's reply ended in its over-capacity error, with no answer.
  [/\bCLAUDE_BUSY\b/, 'busy'],
  [/\b(?:Gemini|ChatGPT|Perplexity) input area not found\b/, 'notReady'],
  [/\bTimeout waiting for: (?:ChatGPT|Perplexity) input area\b/, 'notReady'],
  // Thrown when the composer would not take the text, before the send control is clicked.
  [/\b(?:ChatGPT|Claude) composer never registered the prompt\b/, 'notReady'],
  [/\bPerplexity never registered the prompt\b/, 'notReady'],
  [/\bClaude send button is not available\b/, 'notReady'],
];

/** Uploads run before the prompt is typed. */
const UPLOAD_PHASE_REASONS: Record<string, ProviderFallbackReason> = {
  'not-signed-in': 'signIn',
  'composer-missing': 'notReady',
};

/** Why another provider may take this message instead, or null when it must not move on. */
export function providerFallbackReason(err: unknown): ProviderFallbackReason | null {
  const message = err instanceof Error ? err.message : String(err ?? '');
  const upload = parseUploadFailure(message);
  if (upload) return UPLOAD_PHASE_REASONS[upload.phase] ?? null;
  for (const [pattern, reason] of NO_ANSWER_FAILURES) {
    if (pattern.test(message)) return reason;
  }
  return null;
}

/**
 * Chat-window sends and the hotkey only. Bots, flows and `/agent` name their provider on purpose
 * (or reach it through other paths); a BYOK key is not a web page; a provider the app picked for
 * what only it can do (Gemini reading a video link) stays.
 */
export function taskMayFallBack(task: Task, targetUrl: string, enabled: boolean): boolean {
  if (!enabled || task.providerPinned) return false;
  if (task.source !== 'ui' && task.source !== 'hotkey') return false;
  return webProviderOf(targetUrl) !== null;
}

export interface CandidateNeeds {
  hidden: readonly Provider[];
  attachmentCount: number;
  imageRequest: boolean;
  temporary: boolean;
}

/** A cookie read in the worker's session: nothing is loaded, and an unreadable store counts as signed out. */
async function readSignedIn(provider: Provider): Promise<boolean> {
  try {
    return await getAccountStatus(provider);
  } catch {
    return false;
  }
}

/**
 * The providers to try after `tried`, best first: signed in as far as the app can tell, visible
 * in the model menu, and able to take this message.
 */
export async function nextFallbackProviders(
  tried: readonly Provider[],
  needs: CandidateNeeds,
  isSignedIn: (provider: Provider) => Promise<boolean> = readSignedIn,
): Promise<Provider[]> {
  const unknown = PROVIDER_FALLBACK_ORDER.filter((provider) => !tried.includes(provider) && !needs.hidden.includes(provider));
  const answers = await Promise.all(unknown.map(async (provider) => ((await isSignedIn(provider)) ? provider : null)));
  const signedIn = new Set(answers.filter((provider): provider is Provider => provider !== null));
  return fallbackCandidates({ tried, signedIn, ...needs });
}

export interface FallbackAttempt {
  provider: Provider;
  reason: ProviderFallbackReason;
}

export type FallbackOutcome<T> =
  | { ok: true; value: T; targetUrl: string; switched: TurnProviderSwitch | null; attempts: FallbackAttempt[] }
  | { ok: false; error: unknown; targetUrl: string; attempts: FallbackAttempt[] };

export interface FallbackSendArgs<T> {
  targetUrl: string;
  /** False keeps today's single send exactly, sign-in window included. */
  enabled: boolean;
  send: (targetUrl: string) => Promise<T>;
  /** The providers still worth trying after `tried`, best first; read again before each switch. */
  candidates: (tried: readonly Provider[]) => Promise<Provider[]>;
  onSwitch?: (failed: FallbackAttempt, next: Provider) => void;
}

/**
 * Sends, and on a no-answer failure moves on to the next candidate — each provider at most once.
 * When every candidate fails that way, the outcome carries the first provider's error. A candidate
 * that fails any other way ends the chain with its own error.
 */
export async function sendWithProviderFallback<T>(args: FallbackSendArgs<T>): Promise<FallbackOutcome<T>> {
  const first = webProviderOf(args.targetUrl);
  if (!args.enabled || !first) {
    try {
      return { ok: true, value: await args.send(args.targetUrl), targetUrl: args.targetUrl, switched: null, attempts: [] };
    } catch (error: unknown) {
      return { ok: false, error, targetUrl: args.targetUrl, attempts: [] };
    }
  }

  const { value: outcome, prompts } = await withDeferredSignIn(() => runChain(args, first));
  // Nothing answered: the first sign-in window is what the user acts on, as without the chain.
  if (!outcome.ok && prompts.length > 0) await prompts[0]();
  return outcome;
}

async function runChain<T>(args: FallbackSendArgs<T>, first: Provider): Promise<FallbackOutcome<T>> {
  const attempts: FallbackAttempt[] = [];
  const tried: Provider[] = [first];
  let targetUrl = args.targetUrl;
  let firstError: unknown;
  for (;;) {
    try {
      const value = await args.send(targetUrl);
      const switched = attempts.length > 0 ? { f: attempts[0].provider, r: attempts[0].reason } : null;
      return { ok: true, value, targetUrl, switched, attempts };
    } catch (error: unknown) {
      if (attempts.length === 0) firstError = error;
      const reason = providerFallbackReason(error);
      if (!reason) return { ok: false, error, targetUrl, attempts };
      const failed = { provider: providerFromUrl(targetUrl), reason };
      attempts.push(failed);
      const [next] = await args.candidates(tried);
      if (!next) return { ok: false, error: firstError, targetUrl: args.targetUrl, attempts };
      args.onSwitch?.(failed, next);
      tried.push(next);
      targetUrl = PROVIDER_URLS[next];
    }
  }
}

/**
 * What a failed send adds after its error: which provider it was moved to, or which ones were
 * tried; '' when it never moved on.
 */
export function describeFallbackFailure(
  outcome: { targetUrl: string; attempts: readonly FallbackAttempt[] },
  t: (key: string) => string,
): string {
  const [origin, ...others] = outcome.attempts;
  if (!origin) return '';
  const endedOn = providerFromUrl(outcome.targetUrl);
  if (endedOn !== origin.provider) {
    return fillTemplate(t('chat.providerFallback.sentTo'), {
      reason: fallbackReasonText(origin.provider, origin.reason, t),
      provider: PROVIDER_LABELS[endedOn],
    });
  }
  if (others.length === 0) return '';
  return fillTemplate(t('chat.providerFallback.exhausted'), {
    providers: others.map((attempt) => PROVIDER_LABELS[attempt.provider]).join(' / '),
  });
}
