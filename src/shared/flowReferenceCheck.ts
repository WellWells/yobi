import type { FlowVariable, SkillInstance, TriggerConfig } from './types';
import { FLOW_VAR_PREFIX } from './flowVariables';

// Validates every {{variable}} reference in a generated flow against what the
// executor can actually resolve. The runtime silently interpolates unknown
// variables to '' (interpolation.ts), so a hallucinated or forward reference
// would otherwise produce a silently-broken flow; rejecting here feeds a
// precise error back into the LLM repair loop instead.

const FILE_PRODUCER_TYPES = new Set<string>(['capture', 'file_write', 'file_download']);
const LLM_EXPORT_FORMATS = new Set<string>(['png', 'webp', 'pdf']);
const BOT_TRIGGER_VARS = new Set<string>(['bot.triggerChatId', 'bot.triggerUserId', 'bot.triggerPlatform']);
const VAR_REF_RE = /\{\{([^{}]+)\}\}/g;

function isFileProducer(step: SkillInstance): boolean {
  if (FILE_PRODUCER_TYPES.has(step.type)) return true;
  // exportFormat is normalized to lowercase by flowValidation, matching the
  // runtime's exact-match isCaptureFormat gate.
  return step.type === 'llm' && LLM_EXPORT_FORMATS.has(step.config.exportFormat ?? '');
}

function triggerInputVariables(triggers: TriggerConfig[]): string[] {
  const vars: string[] = [];
  for (const trigger of triggers) {
    if (trigger.type === 'bot') vars.push(trigger.botInputVariable?.trim() || 'input');
    else if (trigger.type === 'chat') vars.push(trigger.chatInputVariable?.trim() || 'input');
  }
  return vars;
}

// The executor runs each loop iteration on a COPY of the outer context, so
// body outputs (including {{file}}) are gone after end_loop; each frame
// records what to roll back when its loop closes.
interface LoopFrame {
  loopVar: string;
  addedKeys: string[];
  fileBefore: boolean;
}

export function checkVariableReferences(
  steps: SkillInstance[],
  triggers: TriggerConfig[],
  variables: FlowVariable[] = [],
): string | null {
  const hasBotTrigger = triggers.some((t) => t.type === 'bot');
  // Exact-name variables: plain strings with no sub-fields.
  const exactVars = new Set<string>(['clipboard', 'timestamp', 'flow.name', ...triggerInputVariables(triggers)]);
  if (hasBotTrigger) BOT_TRIGGER_VARS.forEach((v) => exactVars.add(v));
  // Flow variables are seeded before step 0, so every declared one resolves
  // everywhere. Registering the root as well turns a typo into "{{var}} has no
  // 'feedUrls' sub-variable" rather than the generic unknown-variable error.
  for (const variable of variables) exactVars.add(`${FLOW_VAR_PREFIX}.${variable.key}`);
  const exactRoots = new Set<string>(['clipboard', 'timestamp', 'flow', FLOW_VAR_PREFIX]);

  const keyDefinedAt = new Map<string, number>();
  steps.forEach((step, i) => {
    if (step.outputKey && !keyDefinedAt.has(step.outputKey)) keyDefinedAt.set(step.outputKey, i);
  });

  const availableKeys = new Set<string>();
  const frames: LoopFrame[] = [];
  let fileAvailable = false;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const at = `Step ${i + 1} ("${step.type}")`;

    // Comment steps are documentation — their note is never used at runtime,
    // so a {{placeholder}} inside one must not fail the flow.
    if (step.type !== 'comment') {
      for (const value of Object.values(step.config)) {
        for (const match of value.matchAll(VAR_REF_RE)) {
          const name = match[1].trim();
          if (!name) continue;
          const root = name.split('.')[0].trim();

          if (exactVars.has(name)) continue;
          if (availableKeys.has(root) || frames.some((f) => f.loopVar === root)) continue;

          if (root === 'file') {
            if (fileAvailable) continue;
            return `${at} references {{file}}, but no file-producing step (capture, file_write, file_download, or llm with exportFormat) runs before it in the same scope — a file produced inside a loop is not available after end_loop`;
          }
          if (root === 'bot') {
            if (!hasBotTrigger) return `${at} references {{${name}}}, but the flow has no bot trigger`;
            return `${at} references unknown variable {{${name}}} — bot triggers expose only {{bot.triggerChatId}} and {{bot.triggerUserId}}`;
          }
          if (exactRoots.has(root)) {
            return `${at} references unknown variable {{${name}}} — {{${root}}} has no "${name.slice(root.length + 1)}" sub-variable`;
          }
          const definedAt = keyDefinedAt.get(root);
          if (definedAt !== undefined) {
            return definedAt >= i
              ? `${at} references {{${root}}} before it is produced (it is the outputKey of step ${definedAt + 1}) — reorder the steps or fix the reference`
              : `${at} references {{${root}}}, which is produced inside a loop and no longer exists after its end_loop — move this step inside the loop or aggregate the value first`;
          }
          return `${at} references unknown variable {{${name}}} — every {{...}} must be an EARLIER step's outputKey, an active loop variable, or a documented built-in`;
        }
      }
    }

    // A step's output enters scope only after it. A loop step's own outputKey
    // is written to the OUTER context before the body expands, so it belongs
    // to the enclosing frame and survives its end_loop.
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

  return null;
}
