import type { FlowDefinition, SkillInstance, SkillType } from '../types';
import { DEFAULT_SKILL_CONFIG } from '../flowSkillSpecs';

export type StepSpec = [SkillType, Record<string, string>, string?];

/** Steps are unlabeled: a failure is named by its skill, in the app language. */
export function stepsOf(flowId: string, list: StepSpec[]): SkillInstance[] {
  return list.map(([type, config, outputKey = ''], index) => ({ id: `${flowId}-${index + 1}`, type, label: '', config, outputKey }));
}

export const REPLY = { chatId: '{{bot.triggerChatId}}', attachment: '', attachmentType: 'auto', preview: '', emitFailFlag: 'true' };
export const END_IF: [SkillType, Record<string, string>] = ['end_if', {}];

export function flowOf(id: string, name: string, command: string, steps: SkillInstance[]): FlowDefinition {
  return {
    id,
    name,
    description: '',
    enabled: true,
    trigger: { type: 'bot', botCommand: command, botInputVariable: 'input' },
    steps,
    createdAt: '',
    updatedAt: '',
  };
}

export function chatFlowOf(id: string, name: string, steps: SkillInstance[]): FlowDefinition {
  const flow = flowOf(id, name, '', steps);
  return { ...flow, trigger: { type: 'chat', chatCommand: id, chatInputVariable: 'input' } };
}

/**
 * The bot's default model (Settings → the bot's model; blank follows the app), filled in when a
 * bot message runs a flow. A bot has no composer, so its buttons follow the model its messages
 * already answer on, a BYOK key included.
 */
export const BOT_MODEL_VARIABLE = 'bot.modelUrl';
export const BOT_MODEL = `{{${BOT_MODEL_VARIABLE}}}`;

/**
 * The model the desktop chat has picked when the person pressed the button or pasted the link;
 * the chat command passes it in. Blank
 * falls back to the app's default model.
 */
export const CHAT_MODEL_VARIABLE = 'chat.modelUrl';
export const CHAT_MODEL = `{{${CHAT_MODEL_VARIABLE}}}`;

/** One answer to a fixed prompt, on `provider`: the bot's model in a bot chat, the chat's own model on the desktop. */
export function llmStep(prompt: string, provider: string): [SkillType, Record<string, string>, string] {
  return ['llm', { ...DEFAULT_SKILL_CONFIG.llm, prompt, provider }, 'llm_1'];
}
