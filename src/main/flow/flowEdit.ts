import type { AgentFlowRecipient, FlowBuildIssue, FlowDefinition, SkillType } from '../../shared/types';
import { ALWAYS_INCLUDED_SKILLS, MAX_SELECTED_SKILLS, SKILL_TYPES } from '../../shared/flowSkillSchema';
import { flowRecipients, resolveFlowRecipients } from '../../shared/botRecipients';
import type { RecipientDirectory } from '../../shared/botRecipients';
import { withRecipientQuestion } from '../../shared/botRecipientQuestion';
import type { RecipientWording } from '../../shared/botRecipientQuestion';
import { lazyRecipients, recipientWording } from './botRecipientDirectory';
import { assessFlowSupport, reviseFlowDefinition } from './flowGenerator';
import { lintGeneratedFlow, recipientBuildIssues } from './flowLint';
import { SENSITIVE_STEP_TYPES, diffFlows, isEmptyDiff, mergeRevision, sameStep } from './flowRevision';
import type { FlowDiff } from './flowRevision';
import { probeReadiness, snapshotIntegrations } from './flowReadiness';
import type { IntegrationSnapshot } from './flowReadiness';
import type { FlowExecutorDeps } from './types';
import { sendLog } from '../helpers';

/**
 * Changing a flow the user already has: `/agent`'s `edit_flow`.
 *
 * The same two model calls a build makes — an assessment, to learn which skills the changed flow
 * needs, then the compiler, shown the saved flow and asked for the whole of it back with the
 * change made. Everything around them is local: which flow is meant, which step is which, what
 * changed, and who a bot step sends to.
 *
 * Step ids are the part that must survive. A feed's seen-cache and checkpoints are keyed by the
 * step id and pruned when the id disappears, so a revision that renumbered every step would make
 * the next run treat every old article as new.
 */

export { diffFlows, isEmptyDiff, mergeRevision } from './flowRevision';
export type { FlowDiff, StepRef } from './flowRevision';

export interface FlowRef {
  id: string;
  name: string;
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[「」『』"“”'‘’]/g, '').replace(/\s+/g, ' ').trim();
}

export type EditTarget =
  | { kind: 'found'; flow: FlowDefinition }
  | { kind: 'none' | 'ambiguous'; candidates: FlowDefinition[] };

const MAX_CANDIDATES = 8;

/** Most recently touched first: the flows this conversation made, then everything by last save. */
function candidatesFrom(flows: readonly FlowDefinition[], recent: readonly FlowRef[], pool?: readonly FlowDefinition[]): FlowDefinition[] {
  const recentIds = [...recent].reverse().map((ref) => ref.id);
  const rank = (flow: FlowDefinition): number => {
    const index = recentIds.indexOf(flow.id);
    return index >= 0 ? index : recentIds.length;
  };
  return [...(pool ?? flows)]
    .sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, MAX_CANDIDATES);
}

/** Among several matches, the one this conversation touched last; otherwise no guess. */
function preferRecent(matches: readonly FlowDefinition[], recent: readonly FlowRef[]): FlowDefinition | null {
  for (const ref of [...recent].reverse()) {
    const hit = matches.find((flow) => flow.id === ref.id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Which flow "change it" is about. Blank means the one this conversation made or changed last;
 * a name is matched exactly first and then as a fragment, and a fragment that fits several flows
 * is a question for the user, never a pick.
 */
export function resolveEditTarget(
  query: string,
  flows: readonly FlowDefinition[],
  recent: readonly FlowRef[],
): EditTarget {
  const wanted = normalizeName(query);
  if (!wanted) {
    const last = preferRecent(flows, recent);
    return last ? { kind: 'found', flow: last } : { kind: 'none', candidates: candidatesFrom(flows, recent) };
  }
  const byId = flows.find((flow) => flow.id === query.trim());
  if (byId) return { kind: 'found', flow: byId };

  const exact = flows.filter((flow) => normalizeName(flow.name) === wanted);
  const matches = exact.length > 0
    ? exact
    : flows.filter((flow) => {
      const name = normalizeName(flow.name);
      return name.length > 0 && (name.includes(wanted) || wanted.includes(name));
    });
  if (matches.length === 1) return { kind: 'found', flow: matches[0]! };
  if (matches.length > 1) {
    const recentHit = preferRecent(matches, recent);
    return recentHit ? { kind: 'found', flow: recentHit } : { kind: 'ambiguous', candidates: candidatesFrom(flows, recent, matches) };
  }
  return { kind: 'none', candidates: candidatesFrom(flows, recent) };
}

const SAVED_FLOW_RE = /Saved the flow "(.+?)"/;

/**
 * The flows earlier runs of this conversation made or changed, oldest first. Runs written before
 * `flows` was recorded only have the build's observation, which names the flow — enough to find
 * it again when exactly that name is still in the list.
 */
export function conversationFlowRefs(
  runs: ReadonlyArray<{ flows?: readonly FlowRef[]; turns?: ReadonlyArray<{ tool: string; status: string; observation: string }> }>,
  listFlows: () => readonly FlowDefinition[],
): FlowRef[] {
  const recorded: FlowRef[] = [];
  const legacyNames: Array<{ at: number; name: string }> = [];
  for (const run of runs) {
    if (run.flows?.length) {
      recorded.push(...run.flows);
      continue;
    }
    for (const turn of run.turns ?? []) {
      if (turn.tool !== 'build_flow' || turn.status !== 'ok') continue;
      const name = SAVED_FLOW_RE.exec(turn.observation)?.[1];
      if (name) legacyNames.push({ at: recorded.length, name });
      // A placeholder keeps the order; it is filled in below once the flow list has been read.
      if (name) recorded.push({ id: '', name });
    }
  }
  // Nothing to look up: most conversations never built a flow, and they never pay for the list.
  if (recorded.length === 0) return [];
  const flows = listFlows();
  for (const { at, name } of legacyNames) {
    const matches = flows.filter((flow) => flow.name === name);
    recorded[at] = matches.length === 1 ? { id: matches[0]!.id, name } : { id: '', name };
  }
  return recorded.filter((ref) => ref.id && flows.some((flow) => flow.id === ref.id));
}

const CONTROL = new Set<string>(ALWAYS_INCLUDED_SKILLS);
const KNOWN = new Set<string>(SKILL_TYPES);

function workingSkills(types: readonly string[]): SkillType[] {
  return [...new Set(types.filter((type): type is SkillType => KNOWN.has(type) && !CONTROL.has(type)))];
}

/** The request the assessor reads: the flow as it stands, then the user's change in their words. */
export function describeFlowForEdit(flow: FlowDefinition, change: string): string {
  const steps = flow.steps.map((step, index) => `${index + 1}. ${step.label} [${step.type}]`).join('\n');
  return [
    `Change a flow the user already has, "${flow.name}"${flow.description ? ` — ${flow.description}` : ''}.`,
    `It starts by: ${flow.trigger.type}. Its steps now:`,
    steps,
    'Everything already in the flow is settled; ask only about what the change itself leaves open.',
    'The change:',
    change.trim(),
  ].join('\n');
}

export interface FlowEditRequest {
  flow: FlowDefinition;
  change: string;
  deps: FlowExecutorDeps;
  save: (flow: FlowDefinition) => Promise<FlowDefinition>;
  providerUrl?: string;
  /** The user's own words, read for "send it to me"; defaults to `change`. See `FlowBuildRequest.words`. */
  words?: string;
  /**
   * Returns false when the user declines. `recipients`: who the bot steps this change wrote send to.
   * `paused`: the flow was on and will be saved off, because the change adds a step that acts on the computer.
   */
  confirm?: (flow: FlowDefinition, diff: FlowDiff, recipients: AgentFlowRecipient[], paused: boolean) => Promise<boolean>;
  onPhase?: (phase: 'understand' | 'build' | 'verify') => void;
  recipients?: RecipientDirectory;
  wording?: RecipientWording;
  snapshot?: IntegrationSnapshot;
}

export type FlowEditOutcome =
  | { status: 'saved'; flow: FlowDefinition; diff: FlowDiff; issues: FlowBuildIssue[]; paused: boolean }
  | { status: 'questions'; questions: string[] }
  | { status: 'unchanged' }
  | { status: 'declined' }
  | { status: 'failed'; error: string };

export async function runFlowEdit(request: FlowEditRequest): Promise<FlowEditOutcome> {
  const { flow: original, deps } = request;
  const change = request.change.trim();
  if (!change) return { status: 'failed', error: 'Empty change request' };
  const existing = workingSkills(original.steps.map((step) => step.type));
  if (existing.length > MAX_SELECTED_SKILLS) {
    return { status: 'failed', error: `This flow uses ${existing.length} kinds of step, more than can be revised in one go — the user has to change it in the flow editor.` };
  }
  const words = request.words ?? change;
  const recipients = lazyRecipients(request.recipients);

  request.onPhase?.('understand');
  const assessed = await assessFlowSupport(describeFlowForEdit(original, change), deps, {
    ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
  });
  if (!assessed.ok) return { status: 'failed', error: assessed.error };
  let assessment = assessed.assessment;
  if (assessment.verdict === 'none') {
    return { status: 'failed', error: assessment.gaps[0] ?? 'No Yobi skill can make this change' };
  }
  if (assessment.skills.includes('bot')) {
    assessment = withRecipientQuestion(assessment, words, await recipients(), request.wording ?? recipientWording());
  }
  if (assessment.questions.length > 0) return { status: 'questions', questions: assessment.questions };

  // What the flow has now comes first, so a change that adds a skill can never push one it keeps out of the selection.
  const skills = [...new Set([...existing, ...workingSkills(assessment.skills)])];
  request.onPhase?.('build');
  const revised = await reviseFlowDefinition(original, change, skills, deps, {
    ...(request.providerUrl ? { providerUrl: request.providerUrl } : {}),
  });
  if (!revised.ok) return { status: 'failed', error: revised.error };

  request.onPhase?.('verify');
  let next = mergeRevision(original, revised.flow, revised.stepIds);
  const diff = diffFlows(original, next);
  if (isEmptyDiff(diff)) return { status: 'unchanged' };

  const { blocked } = probeReadiness(workingSkills(next.steps.map((step) => step.type)), request.snapshot ?? snapshotIntegrations());
  const issues = lintGeneratedFlow(next, blocked);
  // Only the bot steps this change wrote. One the user left blank on purpose is theirs.
  const touched = new Set(next.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.type === 'bot' && !original.steps.some((before) => before.id === step.id && sameStep(before, step)))
    .map(({ index }) => index));
  let sendsTo: AgentFlowRecipient[] = [];
  if (touched.size > 0) {
    const directory = await recipients();
    const resolved = resolveFlowRecipients(next, directory, { words, only: touched });
    next = resolved.flow;
    issues.push(...recipientBuildIssues(resolved.issues));
    sendsTo = flowRecipients(next, directory, touched);
  }

  // A new flow is saved off so the user reads its computer-acting steps first; so is a change that adds one.
  const paused = next.enabled && [...diff.added, ...diff.changed].some((ref) => SENSITIVE_STEP_TYPES.has(ref.type));
  if (paused) next = { ...next, enabled: false };

  if (request.confirm && !(await request.confirm(next, diff, sendsTo, paused))) return { status: 'declined' };
  const saved = await request.save(next);
  sendLog(`🧩 [Flow] changed "${saved.name}" — +${diff.added.length} −${diff.removed.length} ~${diff.changed.length} step(s)${paused ? ', switched off for review' : ''}`);
  return { status: 'saved', flow: saved, diff, issues, paused };
}
