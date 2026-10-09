import { RESEARCH_PHASE_ORDER } from '../../shared/researchProgress';
import type { ResearchPhase, ResearchPhaseId, ResearchProgress } from '../../shared/researchProgress';
import type { SearchProgress } from './index';

/*
 * Pure: the pipeline's events in, the checklist out. Every function returns a new object, because
 * each snapshot is sent to the renderer as it stands and must not change underneath it.
 */

export const EMPTY_RESEARCH: ResearchProgress = { phases: [] };

function withPhase(progress: ResearchProgress, id: ResearchPhaseId): ResearchPhase[] {
  if (progress.phases.some((phase) => phase.id === id)) return progress.phases;
  // A phase the outline could not promise (a web provider summarizes only when the pages overflow)
  // joins at its place in the order.
  const rank = RESEARCH_PHASE_ORDER.indexOf(id);
  const phases = [...progress.phases];
  const at = phases.findIndex((phase) => RESEARCH_PHASE_ORDER.indexOf(phase.id) > rank);
  phases.splice(at < 0 ? phases.length : at, 0, { id, status: 'pending' });
  return phases;
}

function update(
  progress: ResearchProgress,
  id: ResearchPhaseId,
  patch: (phase: ResearchPhase) => Partial<ResearchPhase>,
): ResearchProgress {
  return {
    ...progress,
    phases: withPhase(progress, id).map((phase) => (phase.id === id ? { ...phase, ...patch(phase) } : phase)),
  };
}

/** Starts a phase; whatever ran before it in the order is finished by now. */
function start(progress: ResearchProgress, id: ResearchPhaseId, patch: Partial<ResearchPhase> = {}): ResearchProgress {
  const rank = RESEARCH_PHASE_ORDER.indexOf(id);
  const started = update(progress, id, () => ({ status: 'running', ...patch }));
  return {
    ...started,
    phases: started.phases.map((phase) => (
      phase.status !== 'failed' && RESEARCH_PHASE_ORDER.indexOf(phase.id) < rank ? { ...phase, status: 'done' } : phase
    )),
  };
}

function finishPhase(progress: ResearchProgress, id: ResearchPhaseId, patch: Partial<ResearchPhase> = {}): ResearchProgress {
  return update(progress, id, () => ({ status: 'done', ...patch }));
}

export function reduceResearchProgress(progress: ResearchProgress, event: SearchProgress): ResearchProgress {
  switch (event.stage) {
    case 'outline':
      return { phases: event.phases.map((id) => ({ id, status: 'pending' })) };
    case 'planning':
      // Empty: the planner is still writing. Queries: the plan is settled and the search starts.
      if (event.queries.length === 0) return start(progress, 'plan');
      return start(
        progress.phases.some((phase) => phase.id === 'plan')
          ? finishPhase(progress, 'plan', { queries: event.queries })
          : progress,
        'search',
      );
    case 'searched':
      return finishPhase(progress, 'search', { hits: event.hits });
    case 'fetching':
      return start(progress, 'read', { done: 0, total: event.count });
    case 'read':
      return update(progress, 'read', (phase) => ({ done: (phase.done ?? 0) + 1 }));
    case 'readFailed':
      return update(progress, 'read', (phase) => {
        const hosts = phase.failedHosts ?? [];
        return {
          failed: (phase.failed ?? 0) + 1,
          failedHosts: hosts.includes(event.host) ? hosts : [...hosts, event.host],
        };
      });
    case 'analyzing':
      return finishPhase(progress, 'read');
    case 'summarizing':
      return start(progress, 'summarize', { done: 0, total: event.total, dropped: 0 });
    case 'summarized':
      return update(progress, 'summarize', (phase) => ({
        done: (phase.done ?? 0) + 1,
        dropped: (phase.dropped ?? 0) + (event.kept ? 0 : 1),
      }));
    case 'synthesizing':
      return start(progress, 'write');
  }
}

export function finishResearch(progress: ResearchProgress, sources: number): ResearchProgress {
  return {
    phases: progress.phases.map((phase) => (phase.status === 'failed' ? phase : { ...phase, status: 'done' })),
    sources,
  };
}

/** Marks where it stopped: the phase that was running, or the first one that never started. */
export function failResearch(progress: ResearchProgress): ResearchProgress {
  const at = progress.phases.findIndex((phase) => phase.status === 'running');
  const target = at >= 0 ? at : progress.phases.findIndex((phase) => phase.status === 'pending');
  if (target < 0) return progress;
  return {
    ...progress,
    phases: progress.phases.map((phase, index) => (index === target ? { ...phase, status: 'failed' } : phase)),
  };
}
