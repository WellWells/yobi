import { AsyncLocalStorage } from 'node:async_hooks';
import type { MetricDomain, MetricOutcome, TokenCounts } from '../shared/types';
import { classifyFailure } from './metricsNormalize';

/**
 * Which part of the app a model request belongs to. Set once at the top of a chat task or a
 * flow run and read back inside the provider layer, so neither `runAutomation` nor
 * `runByokCompletion` needs a domain argument threaded through every caller in between.
 *
 * Requests made outside either scope — flow authoring, the BYOK connection test — carry no
 * domain and are deliberately not counted as usage.
 */
const domains = new AsyncLocalStorage<MetricDomain>();

export function runInMetricDomain<T>(domain: MetricDomain, fn: () => Promise<T>): Promise<T> {
  return domains.run(domain, fn);
}

export function currentMetricDomain(): MetricDomain | null {
  return domains.getStore() ?? null;
}

export interface LlmMeterSinks {
  onRequest: (domain: MetricDomain, outcome: MetricOutcome) => void;
  onKeyResult: (keyId: string, outcome: MetricOutcome, tokens: TokenCounts | null) => void;
  onKeyCooldown: (keyId: string) => void;
}

let sinks: LlmMeterSinks | null = null;

export function setLlmMeterSinks(next: LlmMeterSinks | null): void {
  sinks = next;
}

/** A run the user stopped is not a failure of the model, so it is left out of both tallies. */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = err instanceof Error ? err.name : '';
  return name === 'AbortError' || name === 'FlowAbortError';
}

/**
 * Wraps one round trip to a model — one browser automation, or one BYOK completion including
 * its failover attempts. Counted against whichever domain is in scope.
 */
export async function meterLlmRequest<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const domain = currentMetricDomain();
  if (!domain) return fn();
  try {
    const result = await fn();
    sinks?.onRequest(domain, 'success');
    return result;
  } catch (err: unknown) {
    if (!isAbort(err, signal)) {
      sinks?.onRequest(domain, classifyFailure(err instanceof Error ? err.message : String(err)));
    }
    throw err;
  }
}

/** One attempt against one BYOK key. A failover request produces several of these. */
export function noteKeyResult(
  keyId: string | undefined,
  outcome: MetricOutcome,
  tokens: TokenCounts | null = null,
): void {
  if (keyId) sinks?.onKeyResult(keyId, outcome, tokens);
}

export function noteKeyCooldown(keyId: string | undefined): void {
  if (keyId) sinks?.onKeyCooldown(keyId);
}
