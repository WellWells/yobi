import { FLOW_BUILD_PHASES } from '../../../shared/types';
import type { AgentHelperStep, AgentRunState, AgentStageLabel, AgentTurnRecord } from '../../../shared/types';
import type { ResearchPhase, ResearchProgress, ResearchSearch } from '../../../shared/researchProgress';
import { readableToolId, stepParam } from '../../../shared/agentStepLabel';
import { fillTemplate } from '../../../shared/fillTemplate';
import { researchLabel } from '../../../shared/researchIntent';
import { clipLine } from '../../../shared/textBudget';
import type { AgentTraceTurn } from '../store/useAgentRunStore';
import type { FlowBuildState } from '../store/useFlowBuildStore';

/** Matches the live trace's preview budget, so a reopened run reads the same as it did running. */
const PREVIEW_CHARS = 200;

/**
 * What a row calls its tool, never the raw id: a research row by its depth (`researchLabel`), then
 * Yobi's own names, then the id spelled out. The keys stay inline in `t()`: `i18n:check` only sees a
 * literal template there, and deletes what it cannot see.
 */
export function traceToolLabel(tool: string, config: Record<string, string> | undefined, t: (key: string) => string): string {
  const research = tool === 'research' ? researchLabel(config?.depth, t) : null;
  if (research) return research;
  const step = t(`agent.step.${tool}`);
  if (step !== `agent.step.${tool}`) return step;
  const skill = t(`flow.skill.${tool}`);
  if (skill !== `flow.skill.${tool}`) return skill;
  if (!tool.startsWith('mcp:')) return readableToolId(tool);
  const id = tool.slice('mcp:'.length);
  const connectorTool = t(`settings.mcp.tool.${id}`);
  return connectorTool !== `settings.mcp.tool.${id}` ? connectorTool : readableToolId(id);
}

/** A step in Yobi's words: what it is and what it works on, as in `Searched the web <query>`. */
function programLine(label: string, param: string | undefined): string {
  return param ? `${label} ${param}` : label;
}

/** One call of a helper in one line: its own title, else the program's name for it. */
export function helperStepLine(step: AgentHelperStep, t: (key: string) => string): string {
  return step.doing ?? programLine(traceToolLabel(step.tool, undefined, t), step.param);
}

/** The step's line while it runs: the helper's newest title, the step's own, then the program's. */
function runningLine(row: AgentTraceTurn & { tool: string }, t: (key: string) => string): string {
  return row.helperSteps?.filter((step) => step.doing).at(-1)?.doing
    ?? row.doing
    ?? programLine(traceToolLabel(row.tool, row.config, t), stepParam(row.tool, row.config));
}

/** Steps can end out of order in a batch: the header stays on the newest one, so it does not alternate. */
function newestRunning(steps: readonly AgentTraceTurn[]): (AgentTraceTurn & { tool: string }) | undefined {
  let newest: (AgentTraceTurn & { tool: string }) | undefined;
  for (const row of steps) {
    if (row.status !== 'running' || !row.tool) continue;
    if (!newest || row.turn > newest.turn) newest = { ...row, tool: row.tool };
  }
  return newest;
}

export interface PendingHeaderState {
  command?: boolean;
  /** How many are ahead in the queue; negative when the run is not waiting there. */
  waitAhead: number;
  synthesizing: boolean;
  stage?: AgentStageLabel;
  steps: readonly AgentTraceTurn[];
  title?: string;
  progress?: string;
  /** The run's flow build: its phases come on their own channel, keyed by the run id. */
  build?: FlowBuildState;
}

/** What only the program knows, which outranks any step's line. */
function programState(state: PendingHeaderState, t: (key: string) => string): string | undefined {
  if (state.command) return t('chat.command.running');
  if (state.waitAhead >= 0) return fillTemplate(t('agent.queue.waiting'), { count: String(state.waitAhead) });
  if (state.synthesizing) return t('agent.stage.answering');
  if (state.stage === 'confirming') return t('agent.pending.confirming');
  if (state.stage === 'verifying') return t('agent.pending.verifying');
  return undefined;
}

/**
 * The one line of a pending turn. What the program knows outranks what the model wrote, and the
 * model's title stays up between steps: it comes with the whole reply, so nothing newer exists.
 */
export function pendingHeader(state: PendingHeaderState, t: (key: string) => string): string {
  const program = programState(state, t);
  if (program) return program;
  const running = newestRunning(state.steps);
  if (running) return runningLine(running, t);
  return state.title ?? state.progress ?? t('chat.thinking');
}

/**
 * A phase in a few words: its name, and its count once it has one. The checklist's line adds what
 * the phase carries (queries, hits, the questions it fills); this is all one closed line has room for.
 */
export function researchPhaseBrief(phase: ResearchPhase, t: (key: string) => string): string {
  const counts = phase.total !== undefined && phase.status !== 'pending'
    ? { done: phase.done ?? 0, total: phase.total }
    : undefined;
  switch (phase.id) {
    case 'plan':
      return t('agent.research.phase.plan');
    case 'search':
      return t('agent.research.phase.search');
    case 'read':
      return counts ? fillTemplate(t('agent.research.phase.readCount'), counts) : t('agent.research.phase.read');
    case 'summarize':
      return counts ? fillTemplate(t('agent.research.phase.summarizeCount'), counts) : t('agent.research.phase.summarize');
    case 'analyze':
      return counts ? fillTemplate(t('agent.research.phase.analyzeCount'), counts) : t('agent.research.phase.analyze');
    case 'review':
      return counts ? fillTemplate(t('agent.research.phase.reviewBrief'), counts) : t('agent.research.phase.review');
    case 'write':
      return t('agent.research.phase.write');
  }
}

/** Only `build_flow` reports a build; a build that failed is over, whatever phase it stopped in. */
function buildPhaseBrief(build: FlowBuildState, t: (key: string) => string): string | undefined {
  if (build.error) return undefined;
  const phase = FLOW_BUILD_PHASES.filter((id) => build.phases[id] === 'active').at(-1);
  return phase ? t(`flow.build.phase.${phase}`) : undefined;
}

/**
 * Where the step on the line has got to, said after its title. A title comes once per model reply,
 * and a deep research is one step that runs for minutes: without this the closed line reads the
 * same until it ends. Program states and the time between steps have no phase.
 */
export function pendingPhase(state: PendingHeaderState, t: (key: string) => string): string | undefined {
  if (programState(state, t)) return undefined;
  const running = newestRunning(state.steps);
  if (!running) return undefined;
  if (running.research) {
    const phase = running.research.phases.filter((entry) => entry.status === 'running').at(-1);
    return phase ? researchPhaseBrief(phase, t) : undefined;
  }
  return running.tool === 'build_flow' && state.build ? buildPhaseBrief(state.build, t) : undefined;
}

/** `12s`, `3m 5s`, in the language's own units. */
export function formatTraceElapsed(ms: number, t: (key: string) => string): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  if (total < 60) return fillTemplate(t('chat.trace.seconds'), { seconds: String(total) });
  return fillTemplate(t('chat.trace.minutes'), { minutes: String(Math.floor(total / 60)), seconds: String(total % 60) });
}

/**
 * A saved run rendered in the same shape the live trace uses, so one row component serves both.
 * Observations are clipped here because the rows are single-line; the full text is what
 * `runAsText` is for.
 */
export function traceFromRun(
  turns: readonly AgentTurnRecord[],
  previewLimit = PREVIEW_CHARS,
): AgentTraceTurn[] {
  return turns.map((turn) => ({
    turn: turn.index,
    tool: turn.tool,
    config: turn.config,
    status: turn.status,
    ...(turn.thought ? { thought: clipLine(turn.thought, previewLimit) } : {}),
    ...(turn.doing ? { doing: turn.doing } : {}),
    ...(turn.helperSteps?.length ? { helperSteps: turn.helperSteps } : {}),
    ...(turn.observation ? { preview: clipLine(turn.observation, previewLimit) } : {}),
    ...(turn.research ? { research: turn.research } : {}),
  }));
}

/** `research: read 6/8, unreadable 2 (a.com, b.com) · summarized 6, irrelevant 3 · sources 3`. */
export function researchAsText(progress: ResearchProgress): string {
  const parts = progress.phases.map((phase) => {
    const count = phase.total !== undefined ? ` ${phase.done ?? 0}/${phase.total}` : '';
    const failed = phase.failed ? `, unreadable ${phase.failed} (${(phase.failedHosts ?? []).join(', ')})` : '';
    const dropped = phase.dropped ? `, irrelevant ${phase.dropped}` : '';
    return `${phase.id}${count} ${phase.status}${failed}${dropped}`;
  });
  for (const search of progress.searches ?? []) parts.push(searchAsText(search));
  if (progress.sources !== undefined) parts.push(`sources ${progress.sources}`);
  return `research: ${parts.join(' · ')}`;
}

/** `searched "q" 9 results (used 2, read 1, unreadable 1)`, or `searched "q" refused`. */
function searchAsText(search: ResearchSearch): string {
  if (search.refused) return `searched "${search.query}" refused`;
  const marks = (['used', 'read', 'unreadable'] as const)
    .map((state) => [state, search.results.filter((result) => result.state === state).length] as const)
    .filter(([, count]) => count > 0)
    .map(([state, count]) => `${state} ${count}`);
  return `searched "${search.query}" ${search.results.length} results${marks.length ? ` (${marks.join(', ')})` : ''}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `+12.3s · model 4.1s · tool 38.2s`, from what the record has; empty for records without timings. */
function stepTiming(turn: AgentTurnRecord, startMs: number): string {
  const parts: string[] = [];
  const at = turn.at ? Date.parse(turn.at) : NaN;
  if (Number.isFinite(at) && Number.isFinite(startMs)) parts.push(`+${seconds(at - startMs)}`);
  if (turn.modelMs !== undefined) parts.push(`model ${seconds(turn.modelMs)}`);
  if (turn.toolMs !== undefined) parts.push(`tool ${seconds(turn.toolMs)}`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

/**
 * The time from the last step's end to the run's last write — on a finished run, the model writing
 * the answer. Not stored: it falls out of the step timings, and a guess is worse than nothing when
 * the last record has none.
 */
function answerTiming(state: AgentRunState): string[] {
  const last = state.turns.at(-1);
  if (!state.result || !last?.at || last.toolMs === undefined) return [];
  const ms = Date.parse(state.updatedAt) - (Date.parse(last.at) + last.toolMs);
  return Number.isFinite(ms) && ms >= 0 ? [`answer written in: ${seconds(ms)}`] : [];
}

/**
 * The whole run as plain text, observations uncut: a clipped observation is often the part that
 * explains why the answer and the page disagreed.
 */
export function runAsText(state: AgentRunState): string {
  const startMs = Date.parse(state.createdAt);
  const elapsedMs = Date.parse(state.updatedAt) - startMs;
  const lines = [
    `goal: ${state.goal}`,
    `status: ${state.status}`,
    `started: ${state.createdAt}`,
    `updated: ${state.updatedAt}`,
    ...(Number.isFinite(elapsedMs) ? [`elapsed: ${seconds(elapsedMs)}`] : []),
    ...answerTiming(state),
    ...(state.error ? [`error: ${state.error}`] : []),
    ...(state.errorDetail ? [`detail: ${state.errorDetail}`] : []),
    ...(state.result?.completion?.status === 'partial'
      ? [`completion: partial (${state.result.completion.reason})${state.result.completion.missing ? ` — missing: ${state.result.completion.missing}` : ''}`]
      : []),
    '',
  ];
  for (const turn of state.turns) {
    lines.push(`[${turn.index}] ${turn.tool} — ${turn.status}${stepTiming(turn, startMs)}`);
    if (turn.doing) lines.push(`    doing: ${turn.doing}`);
    if (turn.thought) lines.push(`    thought: ${turn.thought}`);
    lines.push(`    config: ${JSON.stringify(turn.config)}`);
    for (const step of turn.helperSteps ?? []) {
      lines.push(`    helper: ${step.tool}${step.param ? ` ${step.param}` : ''}${step.doing ? ` — ${step.doing}` : ''}`);
    }
    if (turn.research) lines.push(`    ${researchAsText(turn.research)}`);
    lines.push(`    observation: ${turn.observation || '(empty)'}`);
    lines.push('');
  }
  const actions = state.evidence?.actions ?? [];
  if (actions.length > 0) {
    // The part that answers "why did it call that": what was proposed, why it was held back or
    // allowed, and what the result check found.
    lines.push('changes:');
    for (const action of actions) {
      const reasons = action.reasons?.length ? ` (${action.reasons.map((reason) => reason.code).join(', ')})` : '';
      const confirmed = action.confirmed ? ` confirm=${action.confirmed}` : '';
      const outcome = action.outcome ? ` → ${action.outcome}` : '';
      const verified = action.verification ? ` [${action.verification.status}: ${action.verification.evidence}]` : '';
      lines.push(`  [${action.step}] ${action.server}:${action.tool} ${action.verdict}${reasons}${confirmed}${outcome}${verified}`);
      lines.push(`      ${action.label}`);
      for (const reason of action.reasons ?? []) lines.push(`      - ${reason.message}`);
    }
    lines.push('');
  }
  if (state.result) lines.push(`answer: ${state.result.title}`, state.result.content);
  return lines.join('\n').trimEnd();
}
