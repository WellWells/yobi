import { useMemo } from 'react';
import { useFlowStore } from '../../../store/useFlowStore';
import { scopeAt, stepDisplayName, stepSummary } from '../stepSummary';
import { wholeRef } from '../stepSummary/core';
import type { FlowDefinition, SkillInstance, SkillType } from '../../../../../shared/types';

/** A step of the tab chain (Open page → Operate page → Close page), as a form lists it. */
export interface TabChainStep {
  stepId: string;
  /** The card number, 1-based. */
  number: number;
  name: string;
  type: SkillType;
  /** The Open page step's output name: the tab other steps name as `{{tab}}`. */
  tab: string;
  /** The Open page step's address, as written. */
  url: string;
}

function chainStep(steps: readonly SkillInstance[], at: number, t: (key: string) => string): TabChainStep {
  const step = steps[at];
  return {
    stepId: step.id, number: at + 1, name: stepDisplayName(step, t), type: step.type,
    tab: step.outputKey, url: (step.config.url ?? '').trim(),
  };
}

/**
 * The tabs a page step at `index` can name: the Open page steps before it whose output is still in
 * its scope (one opened inside a loop is gone after that loop), in card order.
 */
export function tabOpenersBefore(steps: readonly SkillInstance[], index: number, t: (key: string) => string): TabChainStep[] {
  return [...scopeAt(steps, index).outputs.values()]
    .filter((at) => steps[at]?.type === 'browser_open')
    .sort((a, b) => a - b)
    .map((at) => chainStep(steps, at, t));
}

/**
 * The later steps that work on the tab the Open page step at `index` makes: an Operate or Close
 * page step naming exactly `{{tab}}` while it is in scope, and a Close page step closing all.
 */
export function tabUsersOf(steps: readonly SkillInstance[], index: number, t: (key: string) => string): TabChainStep[] {
  const tab = steps[index]?.outputKey;
  if (!tab) return [];
  const users: TabChainStep[] = [];
  for (let i = index + 1; i < steps.length; i++) {
    const step = steps[i];
    if (step.type !== 'browser_js' && step.type !== 'browser_close') continue;
    const page = (step.config.page ?? '').trim();
    const names = wholeRef(page) === tab && scopeAt(steps, i).outputs.get(tab) === index;
    const closesAll = step.type === 'browser_close' && page.toLowerCase() === 'all';
    if (names || closesAll) users.push(chainStep(steps, i, t));
  }
  return users;
}

const NO_STEPS: readonly SkillInstance[] = [];

function editedFlow(state: { flows: FlowDefinition[]; selectedFlowId: string | null }): FlowDefinition | undefined {
  return state.flows.find((flow) => flow.id === state.selectedFlowId);
}

/**
 * A value derived from the open flow's steps around one step, kept as a string so the form
 * re-renders only when that value changes, not on every keystroke in another card.
 */
function useAroundStep<T>(stepId: string, derive: (flow: FlowDefinition | undefined, steps: readonly SkillInstance[], index: number) => T): T {
  const key = useFlowStore((state) => {
    const flow = editedFlow(state);
    const steps = flow?.steps ?? NO_STEPS;
    return JSON.stringify(derive(flow, steps, steps.findIndex((step) => step.id === stepId)));
  });
  return useMemo(() => JSON.parse(key) as T, [key]);
}

export interface TabPickerFacts {
  openers: TabChainStep[];
  /** What the flow's checks say about the tab it names (no opening step, already closed), if anything. */
  issue: { text: string; tone: 'error' | 'warning' } | null;
}

/** For an Operate or Close page step: the tabs it can name, and what is wrong with the one it names. */
export function useTabPickerFacts(stepId: string, t: (key: string) => string): TabPickerFacts {
  return useAroundStep(stepId, (flow, steps, index): TabPickerFacts => {
    if (index < 0) return { openers: [], issue: null };
    const summary = stepSummary(steps[index], {
      t, index, steps, variables: flow?.variables, triggers: flow ? [flow.trigger, ...(flow.extraTriggers ?? [])] : undefined,
    });
    const issue = summary.issue && (summary.state === 'error' || summary.state === 'warning')
      ? { text: summary.issue, tone: summary.state }
      : null;
    return { openers: tabOpenersBefore(steps, index, t), issue };
  });
}

/** For an Open page step: the later steps that use its tab. */
export function useTabUsers(stepId: string, t: (key: string) => string): TabChainStep[] {
  return useAroundStep(stepId, (_flow, steps, index) => (index < 0 ? [] : tabUsersOf(steps, index, t)));
}
