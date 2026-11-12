import { SKILL_FILE, hasFatalIssue, parseSkillMarkdown, skillTriggerText } from '../../shared/agentSkills';
import type { SkillTextFiles, SkillTryResult, SkillTryScript } from '../../shared/skillAuthoring';
import type { AgentTraceEvent } from '../../shared/types';
import { offeredSkills } from '../flow/agent/agentSkillTool';
import { runAgent } from '../flow/agent/agentEngine';
import { skillTestScope } from '../flow/agent/agentTools';
import type { FlowExecutorDeps } from '../flow/types';
import { sendLog } from '../helpers';
import type { AgentSkillEntry } from './skillStore';
import { stageSkillDraft } from './skillTextFiles';

/*
 * "Try it": one request the user types, run the way a real request would be — the agent on the
 * model the user picked, the draft (a staged copy, not the installed skill) offered beside the
 * other installed skills, read-only tools, no connectors (their catalog is tokens on every turn).
 * What comes back is what the user needs to judge it: which skill the agent loaded, which scripts
 * it ran and the answer. One click is one run; nothing grades the answer with another model call,
 * and nothing is saved, remembered or changed.
 */

/** Room to load the skill, read a file, run its script twice and answer. */
export const TRY_MAX_TURNS = 8;

export interface SkillTryRun {
  files: SkillTextFiles;
  /** The installed skill the files belong to: its other files are staged with them, and its copy is not offered. */
  base?: string;
  request: string;
  /** The other enabled skills, offered beside the draft as a real request would see them. */
  installed: readonly AgentSkillEntry[];
  providerUrl: string;
  deps: FlowExecutorDeps;
  signal?: AbortSignal;
}

/** The skills the run loaded and the scripts it ran through `use_skill`, from the run itself. */
function skillWatcher(names: readonly string[]): { onTrace: (event: AgentTraceEvent) => void; loaded: string[]; scripts: SkillTryScript[] } {
  const loaded: string[] = [];
  const scripts: SkillTryScript[] = [];
  const pending = new Map<number, SkillTryScript>();
  const nameOf = (raw: string): string => names.find((name) => name.toLowerCase() === raw.trim().toLowerCase()) ?? raw.trim();
  return {
    loaded,
    scripts,
    onTrace: (event) => {
      if (event.kind === 'tool' && event.tool === 'use_skill') {
        const skill = nameOf(event.config.skill ?? '');
        if (skill && !loaded.includes(skill)) loaded.push(skill);
        const command = [event.config.run, event.config.args].map((part) => part?.trim() ?? '').filter(Boolean).join(' ');
        if (command) pending.set(event.turn, { skill, command, ok: false });
      }
      if (event.kind === 'observation' && event.tool === 'use_skill') {
        const script = pending.get(event.turn);
        if (!script) return;
        pending.delete(event.turn);
        scripts.push({ ...script, ok: event.status === 'ok' });
      }
    },
  };
}

export async function runSkillTry(run: SkillTryRun): Promise<SkillTryResult> {
  const doc = run.files[SKILL_FILE];
  if (doc === undefined || !run.request.trim()) return { ok: false, reason: 'invalid' };
  const parsed = parseSkillMarkdown(doc, run.base ?? '');
  if (!parsed.name || hasFatalIssue(parsed.issues)) return { ok: false, reason: 'invalid' };
  const draft: AgentSkillEntry = { name: parsed.name, trigger: skillTriggerText(parsed), modelInvocable: parsed.modelInvocable };
  const entries = [...run.installed.filter((entry) => entry.name !== run.base && entry.name !== draft.name), draft];
  // Only named, it would not be offered for this request at all: no model call can say otherwise.
  if (!offeredSkills(entries, run.request).some((entry) => entry.name === draft.name)) return { ok: false, reason: 'onlyNamed' };
  const staged = await stageSkillDraft(run.files, run.base);
  const watcher = skillWatcher(entries.map((entry) => entry.name));
  try {
    sendLog(`🧩 [Skills] trying "${draft.name}" on ${run.providerUrl}`);
    const result = await runAgent(run.request, run.providerUrl, run.deps, {
      toolScope: skillTestScope(),
      noConnectors: true,
      skillEntries: entries,
      skillDirOf: (name) => (name === draft.name ? staged.dir : null),
      maxTurns: TRY_MAX_TURNS,
      onTrace: watcher.onTrace,
      ...(run.signal ? { signal: run.signal } : {}),
    });
    const answer = result.kind === 'answer' ? result.answer : result.question;
    sendLog(`🧩 [Skills] try "${draft.name}": loaded ${watcher.loaded.join(', ') || 'no skill'}, ${watcher.scripts.length} script run(s)`);
    return { ok: true, draft: draft.name, answer, loaded: [...watcher.loaded], scripts: [...watcher.scripts] };
  } finally {
    await staged.dispose();
  }
}
