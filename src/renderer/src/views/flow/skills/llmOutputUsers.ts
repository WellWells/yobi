import type { FlowDefinition, SkillInstance } from '../../../../../shared/types';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bareToken(key: string): RegExp {
  return new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g');
}

/**
 * The later steps (1-based card numbers) that read an AI step's bare `{{key}}`. Once the step
 * exports a file that token holds the file's path instead of the answer, so the form names them.
 */
export function bareOutputUsers(flow: FlowDefinition | undefined, stepId: string, key: string): number[] {
  if (!flow || !key) return [];
  const index = flow.steps.findIndex((step) => step.id === stepId);
  if (index < 0) return [];
  const token = bareToken(key);
  const users: number[] = [];
  flow.steps.forEach((step, i) => {
    if (i <= index) return;
    if (Object.values(step.config).some((value) => typeof value === 'string' && new RegExp(token.source).test(value))) users.push(i + 1);
  });
  return users;
}

/** The step's config with every bare `{{key}}` read as the answer text, `{{key.text}}`. */
export function withAnswerText(step: SkillInstance, key: string): Record<string, string> {
  const token = bareToken(key);
  return Object.fromEntries(Object.entries(step.config).map(([field, value]) => [
    field,
    typeof value === 'string' ? value.replace(token, `{{${key}.text}}`) : value,
  ]));
}
