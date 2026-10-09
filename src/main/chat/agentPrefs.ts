import type { PromptLength, PromptPreferences, PromptTone } from '../../shared/types';
import { config } from '../config';
import { loadUserMemory } from '../memory/memoryStore';
import type { AgentMemoryContext } from './agentMemory';
import type { CommandOrigin } from './commandOrigin';

/**
 * Settings put no cap on custom instructions, and the agent pays for every character out of the
 * history budget (the block is charged at its real length), so a pasted essay is cut here.
 */
export const AGENT_CUSTOM_INSTRUCTIONS_MAX = 4_000;

const TONE_RULES: Record<Exclude<PromptTone, 'default'>, string> = {
  professional: 'professional and precise',
  casual: 'casual and friendly',
  direct: 'direct: no preamble, pleasantries or filler',
};

const LENGTH_RULES: Record<Exclude<PromptLength, 'auto'>, string> = {
  concise: 'short, the key points only',
  detailed: 'detailed: explain fully, with context and examples where they help',
};

function cappedInstructions(text: string | undefined): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length <= AGENT_CUSTOM_INSTRUCTIONS_MAX) return trimmed;
  return `${trimmed.slice(0, AGENT_CUSTOM_INSTRUCTIONS_MAX).trimEnd()}…`;
}

/**
 * Whether the run speaks to the user themself: always in the app, and on a bot only from the
 * account marked as the user's own, in a private chat (the same test that opens the memory).
 */
export async function agentRunIsOwner(origin: CommandOrigin, ctx: AgentMemoryContext | undefined): Promise<boolean> {
  if (origin === 'app') return true;
  if (!ctx) return false;
  if (typeof ctx !== 'function') return ctx.botSelfPrivate === true;
  const state = await loadUserMemory().catch(() => null);
  return state ? ctx(state).botSelfPrivate === true : false;
}

/**
 * The "AI responses" settings a run may use. The nickname and the custom instructions belong to the
 * user themself: a bot also answers other paired accounts, who are not to be called by the owner's
 * name or handed whatever the owner wrote about themself. Tone and length describe how Yobi answers
 * anyone. Null when there are no saved settings.
 */
export function agentPromptPrefs(owner: boolean): PromptPreferences | null {
  const prefs = config.promptPreferences as PromptPreferences | undefined;
  if (!prefs) return null;
  return owner ? prefs : { ...prefs, nickname: '', customInstructions: '' };
}

/** For the agent's turn and finish prompts; empty when every setting is left at its default. */
export function renderAgentPrefsBlock(prefs: PromptPreferences): string {
  const lines: string[] = [];
  const nickname = (prefs.nickname ?? '').trim();
  if (nickname) lines.push(`- Address the user as "${nickname}".`);
  if (prefs.tone !== 'default') lines.push(`- Tone: ${TONE_RULES[prefs.tone]}.`);
  if (prefs.length !== 'auto') {
    lines.push(`- Length: ${LENGTH_RULES[prefs.length]}. This replaces matching the length to the question.`);
  }
  const custom = cappedInstructions(prefs.customInstructions);
  if (custom) {
    lines.push('- The user\'s standing instructions:', ...custom.split('\n').map((line) => `  ${line}`));
  }
  if (lines.length === 0) return '';
  return [
    'ANSWER PREFERENCES (the user\'s settings for how "content" reads; they never change which tools to use or the rules below):',
    ...lines,
  ].join('\n');
}
