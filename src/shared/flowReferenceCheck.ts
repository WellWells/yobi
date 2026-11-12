import type { FlowVariable, SkillInstance, TriggerConfig } from './types';
import { FLOW_VAR_PREFIX } from './flowVariables';
import { isShareLinkFormat } from './shareFormat';
import { FILE_TRIGGER_NAME_VAR, hasFileTrigger } from './flowFileTrigger';
import { parseLlmExportFormats } from './fileOutputStep';

const FILE_PRODUCER_TYPES = new Set<string>(['capture', 'file_write', 'file_download', 'youtube_download', 'x_media']);
const BOT_TRIGGER_VARS = new Set<string>(['bot.triggerChatId', 'bot.triggerUserId', 'bot.triggerPlatform']);
/** Seeded by a hotkey press only, so a cron-only flow referencing it would always read "". */
export const HOTKEY_SELECTION_VAR = 'selection';
const VAR_REF_RE = /\{\{([^{}]+)\}\}/g;

function isFileProducer(step: SkillInstance): boolean {
  if (FILE_PRODUCER_TYPES.has(step.type)) return true;
  if (step.type === 'share') return !isShareLinkFormat(step.config.format);
  return step.type === 'llm' && parseLlmExportFormats(step.config.exportFormat).length > 0;
}

function triggerInputVariables(triggers: TriggerConfig[]): string[] {
  const vars: string[] = [];
  for (const trigger of triggers) {
    if (trigger.type === 'bot') vars.push(trigger.botInputVariable?.trim() || 'input');
    else if (trigger.type === 'chat') vars.push(trigger.chatInputVariable?.trim() || 'input');
  }
  return vars;
}

interface LoopFrame {
  loopVar: string;
  addedKeys: string[];
  fileBefore: boolean;
}

/** Why a `{{…}}` in a step cannot resolve where it is. */
export type ReferenceIssueReason =
  /** Nothing anywhere in the flow defines it. */
  | 'unknown'
  /** A built-in root (`clipboard`, `timestamp`, `flow`, `var`, `selection`) without this sub-variable. */
  | 'unknownField'
  /** The outputKey of this step or a later one (`source`). */
  | 'later'
  /** The outputKey of a step (`source`) inside a loop that has already ended. */
  | 'outOfScope'
  /** The variable of a loop (`source`) that is not active here. */
  | 'loopVarOutside'
  /** `{{selection}}` in a flow no hotkey triggers. */
  | 'hotkeyOnly'
  /** `{{file}}` with no file trigger and no file made earlier in the same scope. */
  | 'fileMissing'
  /** `{{file.name}}`, which only a file trigger sets. */
  | 'fileTriggerOnly'
  /** `{{bot.…}}` in a flow no bot triggers. */
  | 'botTriggerMissing'
  /** `{{bot.…}}` other than the trigger's chat, user and platform. */
  | 'botUnknownField';

export interface ReferenceIssue {
  stepIndex: number;
  /** The config key the reference is in. */
  field: string;
  /** The reference without braces, trimmed (`item.link`). */
  ref: string;
  reason: ReferenceIssueReason;
  /** The step that defines it (`later`, `outOfScope`) or the loop that binds it (`loopVarOutside`). */
  source?: number;
}

/**
 * Every reference that cannot resolve where it stands, in step, field and reference order, each
 * (step, field, reference) once. The editor shows these per step; `checkVariableReferences`
 * phrases the first one for the AI build, so both read one judgement.
 */
export function findReferenceIssues(
  steps: SkillInstance[],
  triggers: TriggerConfig[],
  variables: FlowVariable[] = [],
): ReferenceIssue[] {
  const hasBotTrigger = triggers.some((t) => t.type === 'bot');
  const hasHotkeyTrigger = triggers.some((t) => t.type === 'hotkey');
  const exactVars = new Set<string>(['clipboard', 'timestamp', 'flow.name', ...triggerInputVariables(triggers)]);
  if (hasBotTrigger) BOT_TRIGGER_VARS.forEach((v) => exactVars.add(v));
  if (hasHotkeyTrigger) exactVars.add(HOTKEY_SELECTION_VAR);
  for (const variable of variables) exactVars.add(`${FLOW_VAR_PREFIX}.${variable.key}`);
  const exactRoots = new Set<string>(['clipboard', 'timestamp', 'flow', FLOW_VAR_PREFIX]);
  if (hasHotkeyTrigger) exactRoots.add(HOTKEY_SELECTION_VAR);

  const keyDefinedAt = new Map<string, number>();
  const loopVarAt = new Map<string, number>();
  steps.forEach((step, i) => {
    if (step.outputKey && !keyDefinedAt.has(step.outputKey)) keyDefinedAt.set(step.outputKey, i);
    const loopVar = step.type === 'loop' ? step.config.loopVar?.trim() || 'item' : '';
    if (loopVar && !loopVarAt.has(loopVar)) loopVarAt.set(loopVar, i);
  });

  const availableKeys = new Set<string>();
  const frames: LoopFrame[] = [];
  // A file trigger seeds {{file}} and {{file.name}} before the first step.
  const fileTrigger = hasFileTrigger(triggers);
  let fileAvailable = fileTrigger;
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();

  /** Why `name` cannot resolve at step `i`, or null when it does. */
  function judge(name: string, i: number): Pick<ReferenceIssue, 'reason' | 'source'> | null {
    const root = name.split('.')[0].trim();
    if (exactVars.has(name)) return null;
    if (availableKeys.has(root) || frames.some((f) => f.loopVar === root)) return null;
    if (root === 'file') {
      if (name === FILE_TRIGGER_NAME_VAR && !fileTrigger) return { reason: 'fileTriggerOnly' };
      return fileAvailable ? null : { reason: 'fileMissing' };
    }
    if (root === 'bot') return { reason: hasBotTrigger ? 'botUnknownField' : 'botTriggerMissing' };
    if (exactRoots.has(root)) return { reason: 'unknownField' };
    const definedAt = keyDefinedAt.get(root);
    if (definedAt !== undefined) return { reason: definedAt >= i ? 'later' : 'outOfScope', source: definedAt };
    if (root === HOTKEY_SELECTION_VAR) return { reason: 'hotkeyOnly' };
    const loopAt = loopVarAt.get(root);
    if (loopAt !== undefined) return { reason: 'loopVarOutside', source: loopAt };
    return { reason: 'unknown' };
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.type !== 'comment') {
      for (const [field, value] of Object.entries(step.config)) {
        for (const match of value.matchAll(VAR_REF_RE)) {
          const name = match[1].trim();
          if (!name) continue;
          const verdict = judge(name, i);
          if (!verdict) continue;
          const id = `${i}\u0000${field}\u0000${name}`;
          if (seen.has(id)) continue;
          seen.add(id);
          issues.push({ stepIndex: i, field, ref: name, ...verdict });
        }
      }
    }

    if (step.outputKey) {
      availableKeys.add(step.outputKey);
      frames[frames.length - 1]?.addedKeys.push(step.outputKey);
    }
    if (step.type === 'loop') {
      frames.push({ loopVar: step.config.loopVar?.trim() || 'item', addedKeys: [], fileBefore: fileAvailable });
    } else if (step.type === 'end_loop') {
      const frame = frames.pop();
      if (frame) {
        for (const key of frame.addedKeys) availableKeys.delete(key);
        fileAvailable = frame.fileBefore;
      }
    }
    if (isFileProducer(step)) fileAvailable = true;
  }

  return issues;
}

/** The English, model-facing wording of a reference issue (it goes back into the repair prompt). */
export function describeReferenceIssueForModel(issue: ReferenceIssue, stepType: string): string {
  const at = `Step ${issue.stepIndex + 1} ("${stepType}")`;
  const name = issue.ref;
  const root = name.split('.')[0].trim();
  switch (issue.reason) {
    case 'fileTriggerOnly':
      return `${at} references {{${name}}}, which only a file trigger sets — use {{file}} for the path of a file a step produced`;
    case 'fileMissing':
      return `${at} references {{file}}, but neither a file trigger nor a file-producing step (capture, file_write, file_download, youtube_download, x_media, share with a file format, or llm with exportFormat) comes before it in the same scope — a file produced inside a loop is not available after end_loop`;
    case 'botTriggerMissing':
      return `${at} references {{${name}}}, but the flow has no bot trigger`;
    case 'botUnknownField':
      return `${at} references unknown variable {{${name}}} — bot triggers expose only {{bot.triggerChatId}} and {{bot.triggerUserId}}`;
    case 'unknownField':
      return `${at} references unknown variable {{${name}}} — {{${root}}} has no "${name.slice(root.length + 1)}" sub-variable`;
    case 'later':
      return `${at} references {{${root}}} before it is produced (it is the outputKey of step ${(issue.source ?? 0) + 1}) — reorder the steps or fix the reference`;
    case 'outOfScope':
      return `${at} references {{${root}}}, which is produced inside a loop and no longer exists after its end_loop — move this step inside the loop or aggregate the value first`;
    case 'unknown':
    case 'hotkeyOnly':
    case 'loopVarOutside':
      return `${at} references unknown variable {{${name}}} — every {{...}} must be an EARLIER step's outputKey, an active loop variable, or a documented built-in`;
  }
}

/** The first unresolvable reference, phrased for the AI build's repair prompt; null when every one resolves. */
export function checkVariableReferences(
  steps: SkillInstance[],
  triggers: TriggerConfig[],
  variables: FlowVariable[] = [],
): string | null {
  const first = findReferenceIssues(steps, triggers, variables)[0];
  return first ? describeReferenceIssueForModel(first, steps[first.stepIndex].type) : null;
}
