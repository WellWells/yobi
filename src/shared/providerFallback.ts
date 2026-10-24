import type { TurnMeta } from './conversationDoc';
import { PROVIDER_ATTACHMENT_POLICIES, PROVIDER_LABELS, PROVIDER_URLS, isByokTargetUrl, providerFromUrl } from './types';
import type { Provider } from './types';
import { chatSendDraws } from './imageRequest';
import { fillTemplate } from './fillTemplate';

/**
 * Why the chosen web provider gave no answer, when that is something another provider can work
 * around: the page wants a sign-in, the account hit its usage limit, the service is over capacity,
 * or the page never became ready to type into.
 */
export const PROVIDER_FALLBACK_REASONS = ['signIn', 'limit', 'busy', 'notReady'] as const;
export type ProviderFallbackReason = (typeof PROVIDER_FALLBACK_REASONS)[number];

/** The order the other providers are tried in, the failed one skipped. */
export const PROVIDER_FALLBACK_ORDER: readonly Provider[] = ['gemini', 'chatgpt', 'claude', 'perplexity'];

/**
 * A turn another provider answered: `f` is the provider the user picked, `r` why it could not
 * answer. Stored on the turn as `sw`; the turn's `p` names the provider that did answer.
 */
export interface TurnProviderSwitch {
  f: Provider;
  r: ProviderFallbackReason;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_URLS, value);
}

function isReason(value: unknown): value is ProviderFallbackReason {
  return typeof value === 'string' && (PROVIDER_FALLBACK_REASONS as readonly string[]).includes(value);
}

/** The turn's switch, or null: the file may have been edited by hand. */
export function readTurnSwitch(meta: TurnMeta | undefined): TurnProviderSwitch | null {
  const raw: unknown = meta?.sw;
  if (!raw || typeof raw !== 'object') return null;
  const { f, r } = raw as { f?: unknown; r?: unknown };
  return isProvider(f) && isReason(r) ? { f, r } : null;
}

/** "Gemini needs sign-in" and its siblings, for the provider that could not take the message. */
export function fallbackReasonText(provider: Provider, reason: ProviderFallbackReason, t: (key: string) => string): string {
  return fillTemplate(t(`chat.providerFallback.reason.${reason}`), { provider: PROVIDER_LABELS[provider] });
}

/**
 * "Gemini needs sign-in — answered by ChatGPT": the line on the answer, and the hotkey's
 * completion banner, which say the same thing.
 */
export function providerSwitchNotice(sw: TurnProviderSwitch, answeredBy: string, t: (key: string) => string): string {
  return fillTemplate(t('chat.providerFallback.answeredBy'), {
    reason: fallbackReasonText(sw.f, sw.r, t),
    provider: answeredBy,
  });
}

export interface FallbackCandidateArgs {
  /** Every provider this task has already been sent to, the first one included. */
  tried: readonly Provider[];
  /** Providers the user hid from the model menu. */
  hidden: readonly Provider[];
  signedIn: ReadonlySet<Provider>;
  attachmentCount: number;
  /** The message asks for a picture: only a page that draws in this chat may take it. */
  imageRequest: boolean;
  /** Yobi's temporary chat: ChatGPT does not draw there. */
  temporary: boolean;
}

/** The providers still worth trying, in `PROVIDER_FALLBACK_ORDER`. */
export function fallbackCandidates(args: FallbackCandidateArgs): Provider[] {
  return PROVIDER_FALLBACK_ORDER.filter((provider) => (
    !args.tried.includes(provider)
    && !args.hidden.includes(provider)
    && args.signedIn.has(provider)
    && PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles >= args.attachmentCount
    && (!args.imageRequest || chatSendDraws(PROVIDER_URLS[provider], { agent: false, temporary: args.temporary }))
  ));
}

/** The web provider a target URL drives, or null for a BYOK key. */
export function webProviderOf(targetUrl: string): Provider | null {
  return isByokTargetUrl(targetUrl) ? null : providerFromUrl(targetUrl);
}
