import { createHash } from 'node:crypto';
import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';

interface OnChangeCheckpoint {
  hash: string;
  updatedAt: string;
}

const store = makeCheckpointStore<OnChangeCheckpoint>('on_change');

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

export async function execOnChange(config: Record<string, string>, stepId: string): Promise<string> {
  const value = (config.value ?? '').trim();
  const hash = hashValue(value);

  const previous = await store.load(stepId);
  if (previous?.hash === hash) {
    sendLog('🔁 [Flow] on_change: unchanged since last run — passing "" (a following stop will halt the flow)');
    return '';
  }

  await store.save(stepId, { hash, updatedAt: new Date().toISOString() });
  sendLog(previous
    ? '🔔 [Flow] on_change: value changed since last run — passing it through'
    : '🔔 [Flow] on_change: first run for this step — passing the value through');
  return value;
}
