/**
 * Checks whether saved API keys still answer: one tiny chat request per key, a few at a time.
 * Shared by the Settings page ("Test all") and the Yobi connector (`yobi_test_api_keys`), so both
 * report the same thing. The key never leaves the main process; results carry only id, name and model.
 */
import { config } from './config';
import type { ByokInstance } from './configTypes';
import { callByokChat } from './providers/byokClient';

export const BYOK_PROBE_TIMEOUT_MS = 30_000;
export const BYOK_TEST_PROMPT = 'Reply with the single word: OK';
/** Many keys on one provider at once could trip its rate limit and read as a dead key. */
const BYOK_TEST_CONCURRENCY = 3;

export interface ByokProbeTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  name: string;
}

export type ByokProbeOutcome = { ok: true; reply: string } | { ok: false; error: string };

export interface ByokKeyTestOutcome {
  id: string;
  name: string;
  model: string;
  outcome: ByokProbeOutcome;
}

/** Sends the test prompt; `error` is the raw message (callers localize it for people). */
export async function probeByokKey(target: ByokProbeTarget): Promise<ByokProbeOutcome> {
  try {
    const { response } = await callByokChat(
      { baseUrl: target.baseUrl.trim(), apiKey: target.apiKey, model: target.model.trim(), label: target.name.trim() },
      BYOK_TEST_PROMPT,
      BYOK_PROBE_TIMEOUT_MS,
    );
    return { ok: true, reply: response.replace(/\s+/g, ' ').trim().slice(0, 120) };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testOne(instance: ByokInstance, probe: typeof probeByokKey): Promise<ByokKeyTestOutcome> {
  const base = { id: instance.id, name: instance.name, model: instance.model };
  if (!instance.apiKey.trim()) return { ...base, outcome: { ok: false, error: 'No API key is saved for this entry.' } };
  return { ...base, outcome: await probe(instance) };
}

/** Tests the saved keys with these ids (all when empty), in the order they are listed in Settings. */
export async function testByokKeys(
  ids: readonly string[] = [],
  probe: typeof probeByokKey = probeByokKey,
): Promise<ByokKeyTestOutcome[]> {
  const wanted = new Set(ids);
  const picked = config.byokInstances.filter((instance) => wanted.size === 0 || wanted.has(instance.id));
  const results: ByokKeyTestOutcome[] = new Array(picked.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < picked.length) {
      const index = next++;
      results[index] = await testOne(picked[index], probe);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BYOK_TEST_CONCURRENCY, picked.length) }, worker));
  return results;
}
