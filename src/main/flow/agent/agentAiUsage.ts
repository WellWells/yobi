import { readAiUsage } from '../../aiUsage';
import type { AiUsageReport } from '../../aiUsage';
import { getOutputDir } from '../../files';
import { FlowAbortError } from '../runtime';
import { runUseSkill } from './agentSkillTool';
import type { SkillRunState } from './agentSkillTool';

export const AI_USAGE_LINE = '- "ai_usage": Check AI account usage on this host in the background with one fixed AgentSwap status command. No config fields. Detects AgentSwap internally; returns limits, resets, host check time, or a missing-installation/error result. Never installs or switches accounts. Repeated calls in this run reuse the result.';

export interface AiUsageContext {
  skills?: SkillRunState;
  signal?: AbortSignal;
  remainingMs?: () => number;
  /** One query per run, also coalescing concurrent calls. A missing install may be checked again. */
  aiUsage?: Promise<AiUsageReport>;
}

/** Recognize whole status requests, never a command prefix or an arbitrary shell program. */
export function isAiUsageStatusCommand(config: Record<string, string>): boolean {
  if (Object.keys(config).some((key) => !['command', 'shell', 'skill'].includes(key))) return false;
  if (config.skill && config.skill !== 'ai-usage') return false;
  if (config.shell && !['cmd', 'powershell', 'sh', 'bash', 'zsh', '/bin/sh', '/bin/bash', '/bin/zsh'].includes(config.shell)) return false;
  const command = config.command ?? '';
  return !/[\r\n\0]/.test(command) && /^[ \t]*(?:agentswap|ccswap|cxswap|agswap)(?:\.exe)?[ \t]+status[ \t]*$/i.test(command);
}

export async function runAiUsage(config: Record<string, string>, ctx: AiUsageContext): Promise<{ observation: string; status: 'ok' | 'error' }> {
  if (ctx.signal?.aborted) throw new FlowAbortError();
  if (Object.keys(config).length) return { status: 'error', observation: 'ERROR: ai_usage accepts no config fields.' };
  if (!ctx.skills?.shell || !ctx.skills.entries.some((skill) => skill.name === 'ai-usage')) {
    return { status: 'error', observation: 'ERROR: Enable the AI usage skill in a run with host command access first.' };
  }
  let instructions = '';
  if (!ctx.skills.loaded.includes('ai-usage')) {
    const loaded = await runUseSkill({ skill: 'ai-usage' }, ctx.skills, ctx.signal);
    if (loaded.status === 'error') return loaded;
    instructions = loaded.observation;
  }
  ctx.aiUsage ??= getOutputDir().then((output) => readAiUsage({
    writeRoots: [output], signal: ctx.signal, timeoutMs: ctx.remainingMs?.(),
  }));
  try {
    const result = await ctx.aiUsage;
    if (result.status === 'missing') ctx.aiUsage = undefined;
    return {
      status: result.status === 'ok' ? 'ok' : 'error',
      observation: `HOST CHECK: ${result.checkedAt} (${result.timezone})\nSTATUS: ${result.status}\nThis combined check covers all supported providers. Do not run separate status commands; answer from this result.\nPercentages are usage consumed, not remaining. Account numbers and safe local aliases identify accounts; email domains are removed. Never reconstruct full addresses.\n${result.output}${instructions ? `\n\n${instructions}` : ''}`,
    };
  } catch (error) {
    if (ctx.signal?.aborted) throw new FlowAbortError();
    throw error;
  }
}
