import type { ProgressState } from '../../../../components/ProgressMark';
import type { SkillDraftCallPurpose, SkillDraftStep } from '../../../../../../shared/skillAuthoring';

/*
 * What a draft is doing, as rows the editor lists while it waits: each model call (with how long it
 * has taken), then the checks on this computer. A round's checks are listed as soon as its call
 * starts, so the user sees what comes after the wait. Times are this page's clock: each row starts
 * when its step reaches the page.
 */

export type DraftRow =
  | { kind: 'model'; status: ProgressState; purpose: SkillDraftCallPurpose; call: number; budget: number; startedAt: number; endedAt?: number }
  | { kind: 'unusable'; status: ProgressState }
  | { kind: 'lint'; status: ProgressState; errors?: number }
  | { kind: 'runs'; status: ProgressState; done?: number; total?: number; failed?: number }
  | { kind: 'stopped'; status: ProgressState };

/** How the draft ended: `questions` hands over to the questions, `stopped` is the user's Stop. */
export type DraftOutcome = 'done' | 'questions' | 'failed' | 'stopped';

export interface DraftProgress {
  startedAt: number;
  rows: DraftRow[];
  outcome?: DraftOutcome;
  endedAt?: number;
}

export function startDraftProgress(now: number): DraftProgress {
  return { startedAt: now, rows: [] };
}

function settle(row: DraftRow, status: ProgressState, now: number): DraftRow {
  if (row.status !== 'active') return row;
  return row.kind === 'model' ? { ...row, status, endedAt: now } : { ...row, status };
}

/** The rows with the running one ended and the waiting ones gone. */
function closed(rows: readonly DraftRow[], status: ProgressState, now: number): DraftRow[] {
  return rows.filter((row) => row.status !== 'pending').map((row) => settle(row, status, now));
}

function updateLast(rows: DraftRow[], kind: DraftRow['kind'], change: (row: DraftRow) => DraftRow): DraftRow[] {
  const at = rows.map((row) => row.kind).lastIndexOf(kind);
  if (at < 0) return rows;
  const next = [...rows];
  next[at] = change(rows[at]);
  return next;
}

export function applyDraftStep(progress: DraftProgress, step: SkillDraftStep, now: number): DraftProgress {
  if (progress.outcome) return progress;
  switch (step.kind) {
    case 'model':
      return {
        ...progress,
        rows: [
          ...closed(progress.rows, 'done', now),
          { kind: 'model', status: 'active', purpose: step.purpose, call: step.call, budget: step.budget, startedAt: now },
          { kind: 'lint', status: 'pending' },
          { kind: 'runs', status: 'pending' },
        ],
      };
    case 'unusable':
      return { ...progress, rows: [...closed(progress.rows, 'done', now), { kind: 'unusable', status: 'failed' }] };
    case 'lint': {
      const rows = closed(progress.rows, 'done', now);
      const lint: DraftRow = { kind: 'lint', status: step.errors > 0 ? 'failed' : 'done', errors: step.errors };
      const runs: DraftRow[] = step.runs > 0 ? [{ kind: 'runs', status: 'active', done: 0, total: step.runs, failed: 0 }] : [];
      return { ...progress, rows: [...rows, lint, ...runs] };
    }
    case 'run': {
      const finished = step.done >= step.total;
      const status: ProgressState = !finished ? 'active' : step.failed > 0 ? 'failed' : 'done';
      return {
        ...progress,
        rows: updateLast(progress.rows, 'runs', () => ({ kind: 'runs', status, done: step.done, total: step.total, failed: step.failed })),
      };
    }
  }
}

/** The draft's answer came back: whatever was still running ends the way the draft did. */
export function finishDraftProgress(progress: DraftProgress, outcome: DraftOutcome, now: number): DraftProgress {
  if (progress.outcome) return progress;
  const status: ProgressState = outcome === 'failed' ? 'failed' : outcome === 'stopped' ? 'skipped' : 'done';
  const rows = closed(progress.rows, status, now);
  return {
    ...progress,
    outcome,
    endedAt: now,
    rows: outcome === 'stopped' ? [...rows, { kind: 'stopped', status: 'skipped' }] : rows,
  };
}

/**
 * A finished draft whose last round passed every check says so in one line (the report below has
 * the details); one that stopped, failed or still fails keeps its rows, since where it ended is the
 * useful part.
 */
export function draftEndedClean(progress: DraftProgress): boolean {
  if (progress.outcome !== 'done') return false;
  const lastCall = progress.rows.map((row) => row.kind).lastIndexOf('model');
  return progress.rows.slice(Math.max(0, lastCall)).every((row) => row.status === 'done');
}
