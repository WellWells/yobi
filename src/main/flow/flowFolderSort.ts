import { folderKey, folderNameProblem, normalizeFolderName } from '../../shared/conversationFolders';
import { FLOW_SORT_WHY_MAX_CHARS } from '../../shared/flowFolderSort';
import type { FlowSortGroup } from '../../shared/flowFolderSort';
import type { FlowFolder } from '../../shared/flowFolders';
import { fenceUntrusted } from '../../shared/promptFencing';
import type { FlowDefinition } from '../../shared/types';

/*
 * The model's half of sorting unfiled flows into folders: what it is shown, and how its reply is
 * read. It only proposes; the user ticks what is filed. Flows are named to it by short keys
 * (f1, f2 …) — shorter than ids, and a key it makes up is plainly not one of them.
 */

/** What the repair prompt quotes back of a rejected reply. */
const REJECTED_QUOTE_MAX_CHARS = 2_000;
const DESCRIPTION_MAX_CHARS = 160;
const HOSTS_PER_FLOW = 3;
/** A folder's members shown as examples of how the user groups things. */
const EXAMPLES_PER_FOLDER = 6;
/** More than any sidebar wants; past it the model is listing things it made up. */
const MAX_PROPOSED_GROUPS = 30;
/** A new folder with a single flow is not sorting, it is renaming the flow. */
const MIN_FLOWS_IN_NEW_FOLDER = 2;

/** The unfiled flows as the model sees them, keyed `f1`, `f2` … in the sidebar's order. */
export interface SortSubject {
  key: string;
  flow: FlowDefinition;
}

export function sortSubjects(flows: readonly FlowDefinition[]): SortSubject[] {
  return flows.map((flow, index) => ({ key: `f${index + 1}`, flow }));
}

const URL_HOST = /https?:\/\/([^\s/?#'"<>{}]+)/gi;

/** The sites a flow reads or posts to: often the clearest hint of what it is about. */
function flowHosts(flow: FlowDefinition): string[] {
  const hosts: string[] = [];
  for (const step of flow.steps ?? []) {
    for (const value of Object.values(step.config ?? {})) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(URL_HOST)) {
        const host = match[1]!.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
        if (host && !hosts.includes(host)) hosts.push(host);
        if (hosts.length >= HOSTS_PER_FLOW) return hosts;
      }
    }
  }
  return hosts;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return [...flat].length > max ? `${[...flat].slice(0, max).join('')}…` : flat;
}

/** One line per flow: its name, what starts it, what it is built from, the sites it uses. */
export function describeSubject(subject: SortSubject): string {
  const { flow } = subject;
  const steps = [...new Set((flow.steps ?? []).map((step) => step.type))];
  const hosts = flowHosts(flow);
  const description = oneLine(flow.description ?? '', DESCRIPTION_MAX_CHARS);
  return [
    `[${subject.key}] ${oneLine(flow.name || '(untitled)', 80)}`,
    `starts: ${flow.trigger?.type ?? 'manual'}`,
    steps.length > 0 ? `steps: ${steps.join(', ')}` : '',
    hosts.length > 0 ? `sites: ${hosts.join(', ')}` : '',
    description ? `about: ${description}` : '',
  ].filter(Boolean).join(' | ');
}

export interface SortPromptInput {
  subjects: readonly SortSubject[];
  /** The user's folders, each with a few of the flows already in it. */
  folders: ReadonlyArray<{ name: string; examples: string[] }>;
  /** The language folder names and reasons are written in — the app's. */
  language: string;
  instruction?: string;
  /** The proposal the user is commenting on in `feedback`, in the keys of `subjects`. */
  previous?: ReadonlyArray<{ folder: string; flows: string[] }>;
  feedback?: string;
  /** A reply that could not be used, and why — for the repair attempt. */
  rejected?: { raw: string; error: string };
}

/** The user's folders with up to a few member names each, for the prompt. */
export function folderExamples(folders: readonly FlowFolder[], flows: readonly FlowDefinition[]): SortPromptInput['folders'] {
  const names = new Map(flows.map((flow) => [flow.id, flow.name]));
  return folders.map((folder) => ({
    name: folder.name,
    examples: folder.flowIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)).slice(0, EXAMPLES_PER_FOLDER),
  }));
}

/**
 * One prompt, one answer: every unfiled flow fits, and there is nothing to look up. The model
 * proposes folders; every one it names is shown to the user, who picks what happens.
 */
export function buildSortPrompt(input: SortPromptInput): string {
  const request = [input.instruction?.trim(), input.feedback?.trim()].filter(Boolean).join('\n');
  const folderLines = input.folders.map((folder) => (folder.examples.length > 0
    ? `${folder.name}: ${folder.examples.map((name) => oneLine(name, 60)).join('; ')}`
    : `${folder.name}: (empty)`));
  return [
    'You are sorting the automation flows in a sidebar into folders.',
    'Each flow shows its key, its name, what starts it, the kinds of steps it uses, the sites it reads or posts to, and what it is about.',
    '',
    'GOAL: put each UNSORTED FLOW in the folder where the user would look for it.',
    '',
    'RULES:',
    '- Prefer an EXISTING FOLDER when a flow fits it. Learn how the user groups things from the flows already in each folder (by purpose, topic or source) and follow their lead.',
    `- A new folder needs at least ${MIN_FLOWS_IN_NEW_FOLDER} flows. A flow that fits no folder is left out: it stays where it is.`,
    `- A new folder name is short (one to four words) and says what its flows are for, in ${input.language}; a proper name (a site, a product) stays as written. No emoji, no numbering.`,
    '- Never use a new name that only differs from an existing folder in case or spacing: use the existing folder.',
    '- Every flow appears at most once. Use the keys exactly as given.',
    `- "why" is one short sentence for the user, written in ${input.language}; the user never sees keys, so name no key in it.`,
    '',
    'OUTPUT RULES (critical):',
    'Reply with a single JSON object and nothing else:',
    '{"groups":[{"folder":"...","flows":["f1","f4"],"why":"..."}]}',
    'If no flow fits any folder, reply {"groups":[]}.',
    '',
    'EXISTING FOLDERS (name: some flows already in it):',
    folderLines.length > 0 ? fenceUntrusted('folders', folderLines.join('\n')) : '(none yet)',
    '',
    'UNSORTED FLOWS:',
    fenceUntrusted('flows', input.subjects.map(describeSubject).join('\n')),
    ...(input.previous
      ? ['', 'YOUR LAST PROPOSAL (not applied; the user comments on it below):', fenceUntrusted('proposal', JSON.stringify({ groups: input.previous }))]
      : []),
    ...(input.rejected
      ? [
        '',
        `YOUR PREVIOUS REPLY COULD NOT BE USED: ${input.rejected.error}`,
        fenceUntrusted('reply', input.rejected.raw.slice(0, REJECTED_QUOTE_MAX_CHARS)),
        'Answer again, following OUTPUT RULES (critical).',
      ]
      : []),
    ...(request ? ['', 'USER REQUEST:', request] : []),
  ].join('\n');
}

export interface SortReply {
  groups: FlowSortGroup[];
  leftOver: string[];
}

export type SortValidation = { ok: true; value: SortReply } | { ok: false; error: string };

function keysOf(raw: Record<string, unknown>): string[] {
  const value = raw.flows ?? raw.keys ?? raw.ids;
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => (typeof item === 'string' ? item.trim().replace(/^\[|\]$/g, '').toLowerCase() : ''))
    .filter(Boolean);
}

function cleanWhy(raw: unknown): string {
  return oneLine(typeof raw === 'string' ? raw : '', FLOW_SORT_WHY_MAX_CHARS);
}

/**
 * Turns the model's JSON into groups the review screen can show. A bad group is dropped rather
 * than sent back — a repair is a whole round trip, and the rest of the proposal is still good.
 * Two groups with the same folder become one. Only a reply with no usable shape, or one where
 * every group was bad, is refused.
 */
export function validateSortReply(
  json: unknown,
  subjects: readonly SortSubject[],
  existingFolders: readonly string[],
): SortValidation {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as Record<string, unknown>).groups)) {
    return { ok: false, error: 'Reply with one JSON object that has a "groups" array' };
  }
  const proposed = ((json as Record<string, unknown>).groups as unknown[]).slice(0, MAX_PROPOSED_GROUPS);
  const byKey = new Map(subjects.map((subject) => [subject.key, subject.flow.id]));
  const order = new Map(subjects.map((subject, index) => [subject.flow.id, index]));
  const used = new Set<string>();
  const rejects: string[] = [];
  const merged: Array<Omit<FlowSortGroup, 'key'>> = [];

  for (const raw of proposed) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { rejects.push('a group is not an object'); continue; }
    const item = raw as Record<string, unknown>;
    const name = normalizeFolderName(String(item.folder ?? item.name ?? ''));
    const existing = existingFolders.find((folder) => folderKey(folder) === folderKey(name));
    if (!existing) {
      const problem = folderNameProblem(name, [], undefined, 'label');
      if (problem) { rejects.push(`folder name "${name}" is not usable (${problem})`); continue; }
    }
    const keys = keysOf(item);
    const unknown = keys.find((key) => !byKey.has(key));
    if (unknown) rejects.push(`"${unknown}" is not one of the unsorted flows`);
    const flowIds = [...new Set(keys.map((key) => byKey.get(key)))].filter((id): id is string => Boolean(id) && !used.has(id!));
    if (flowIds.length === 0) { rejects.push(`folder "${name}" has no flow that is not already in an earlier group`); continue; }
    for (const id of flowIds) used.add(id);
    const folder = existing ?? name;
    const same = merged.find((group) => folderKey(group.folder) === folderKey(folder));
    if (same) {
      same.flowIds.push(...flowIds);
      continue;
    }
    merged.push({ folder, isNew: !existing, flowIds, why: cleanWhy(item.why ?? item.reason) });
  }

  const groups: FlowSortGroup[] = [];
  for (const group of merged) {
    if (group.isNew && group.flowIds.length < MIN_FLOWS_IN_NEW_FOLDER) {
      rejects.push(`new folder "${group.folder}" has only one flow`);
      for (const id of group.flowIds) used.delete(id);
      continue;
    }
    group.flowIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    groups.push({ key: `g${groups.length + 1}`, ...group });
  }
  if (proposed.length > 0 && groups.length === 0) {
    return { ok: false, error: `None of the proposed folders could be used: ${rejects.slice(0, 3).join('; ')}` };
  }
  const leftOver = subjects.map((subject) => subject.flow.id).filter((id) => !used.has(id));
  return { ok: true, value: { groups, leftOver } };
}
