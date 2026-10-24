import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * A provider's sign-in window opens in the one worker window every provider is driven in. While a
 * send may still move on to another provider, opening it would hand the user a page that the next
 * attempt navigates away from, so the prompt is held here and the caller decides afterwards:
 * shown when nothing answered, dropped when another provider did.
 */
type SignInPrompt = () => Promise<void>;

const scopes = new AsyncLocalStorage<SignInPrompt[]>();

export interface DeferredSignInResult<T> {
  value: T;
  /** The prompts held back, in the order the providers asked. */
  prompts: SignInPrompt[];
}

export async function withDeferredSignIn<T>(fn: () => Promise<T>): Promise<DeferredSignInResult<T>> {
  const prompts: SignInPrompt[] = [];
  const value = await scopes.run(prompts, fn);
  return { value, prompts };
}

/** Holds the prompt when a caller asked for that; false = show it now, as always. */
export function deferSignInPrompt(prompt: SignInPrompt): boolean {
  const held = scopes.getStore();
  if (!held) return false;
  held.push(prompt);
  return true;
}
