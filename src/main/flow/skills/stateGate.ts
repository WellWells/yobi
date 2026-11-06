import { createHash } from 'node:crypto';
import { sendLog } from '../../helpers';
import { makeCheckpointStore } from '../checkpoint';
import { compactLineDiff, normalizeWatchedText, sameDiffLines } from './changeDiff';
import { envelope } from './dataSources';

/**
 * `hash` is always the hash of the trimmed raw value, in both modes, so turning `withDiff` on or
 * off never reads as a change. `normHash` and `text` exist only while `withDiff` is on: the text
 * is the normalised value, kept so the next change can say what changed.
 */
interface OnChangeCheckpoint {
  hash: string;
  updatedAt: string;
  normHash?: string;
  text?: string;
}

/** Past this the previous text is not kept (only its hashes), and the next change has no diff. */
export const ON_CHANGE_TEXT_MAX_CHARS = 200_000;

const store = makeCheckpointStore<unknown>('on_change');

function hashValue(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

/** A hand-edited or partly restored file may hold anything; a field of the wrong type counts as absent. */
function readCheckpoint(raw: unknown): Partial<OnChangeCheckpoint> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const field = (key: keyof OnChangeCheckpoint): string | undefined =>
    typeof record[key] === 'string' ? record[key] as string : undefined;
  return { hash: field('hash'), updatedAt: field('updatedAt'), normHash: field('normHash'), text: field('text') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local "YYYY-MM-DD HH:MM", or "" for a missing or unreadable time. */
function localStamp(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function logUnchanged(): void {
  sendLog('🔁 [Flow] on_change: unchanged since last run — passing "" (a following stop will halt the flow)');
}

async function plainGate(value: string, stepId: string, previous: Partial<OnChangeCheckpoint> | null): Promise<string> {
  const hash = hashValue(value);
  if (previous?.hash === hash) {
    // Text kept by an earlier withDiff run leaves the disk once the switch is off.
    if (previous.text !== undefined || previous.normHash !== undefined) {
      await store.save(stepId, { hash, updatedAt: previous.updatedAt ?? new Date().toISOString() });
    }
    logUnchanged();
    return envelope('', {});
  }

  await store.save(stepId, { hash, updatedAt: new Date().toISOString() });
  sendLog(previous
    ? '🔔 [Flow] on_change: value changed since last run — passing it through'
    : '🔔 [Flow] on_change: first run for this step — passing the value through');
  return envelope(value, {});
}

function storedText(norm: string): { text?: string } {
  if (norm.length <= ON_CHANGE_TEXT_MAX_CHARS) return { text: norm };
  sendLog(`on_change: text over ${ON_CHANGE_TEXT_MAX_CHARS} chars — kept only its hash; the next change has no line diff`);
  return {};
}

async function diffGate(value: string, stepId: string, previous: Partial<OnChangeCheckpoint> | null): Promise<string> {
  const now = new Date();
  const rawHash = hashValue(value);
  const norm = normalizeWatchedText(value);
  const normHash = hashValue(norm);
  const checkedAt = localStamp(now.toISOString());
  const previousAt = localStamp(previous?.updatedAt);

  const unchanged = async (resave: boolean): Promise<string> => {
    // A hash-only checkpoint gains the text, so the next real change has a diff; a match that
    // only whitespace allowed moves `hash` to this raw text, so switching withDiff off stays quiet.
    if (resave) {
      await store.save(stepId, {
        hash: rawHash,
        normHash,
        ...storedText(norm),
        updatedAt: previous?.updatedAt ?? now.toISOString(),
      });
    }
    logUnchanged();
    return envelope('', {
      isFirstRun: '0', hasDiff: '0', diff: '', added: '0', removed: '0', truncated: '0',
      previous: '', previousAt, checkedAt,
    });
  };

  const sameRaw = previous?.hash === rawHash;
  const sameNorm = previous?.normHash !== undefined && previous.normHash === normHash;
  if (previous && (sameRaw || sameNorm)) return unchanged(previous.normHash === undefined || !sameRaw);

  // Only spacing a long line's split trims away differs: the diff could not show it, so no change.
  if (previous?.text !== undefined && sameDiffLines(previous.text, norm)) return unchanged(true);
  const diff = previous?.text !== undefined ? compactLineDiff(previous.text, norm) : null;

  await store.save(stepId, { hash: rawHash, normHash, ...storedText(norm), updatedAt: now.toISOString() });
  if (!previous) {
    sendLog('🔔 [Flow] on_change: first run for this step — passing the value through');
    return envelope(value, {
      isFirstRun: '1', hasDiff: '0', diff: '', added: '0', removed: '0', truncated: '0',
      previous: '', previousAt: '', checkedAt,
    });
  }

  // Lines that only moved on a page too long for the line table list no "-" or "+" line: still a
  // change, reported like one with no earlier text, never as an empty diff.
  if (previous.text === undefined || !diff || (diff.added === 0 && diff.removed === 0)) {
    sendLog('🔔 [Flow] on_change: value changed since last run — no line diff to show');
    return envelope(value, {
      isFirstRun: '0', hasDiff: '0', diff: '', added: '0', removed: '0', truncated: '0',
      previous: '', previousAt, checkedAt,
    });
  }

  sendLog(`🔔 [Flow] on_change: changed — +${diff.added} / -${diff.removed} lines`);
  return envelope(value, {
    isFirstRun: '0',
    hasDiff: '1',
    diff: diff.text,
    added: String(diff.added),
    removed: String(diff.removed),
    truncated: diff.truncated ? '1' : '0',
    previous: previous.text,
    previousAt,
    checkedAt,
  });
}

/**
 * Edge trigger: the value passes through only when it differs from what this step saw last run
 * (or on its first run), otherwise "". With `withDiff="true"` the step also reports what changed.
 */
export async function execOnChange(config: Record<string, string>, stepId: string): Promise<string> {
  const value = (config.value ?? '').trim();
  const previous = readCheckpoint(await store.load(stepId));
  return config.withDiff === 'true'
    ? diffGate(value, stepId, previous)
    : plainGate(value, stepId, previous);
}
