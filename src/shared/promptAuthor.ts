import { extractTemplateVariables } from './templateVariables';

/**
 * What a draft is for. `youtube` and `maps` are the Settings analysis templates (fixed slots);
 * the flow kinds write one field of a flow step and may only use the step's own data
 * (`variables`); `instructions` tidies the answer preferences' custom instructions.
 */
export type PromptAuthorKind = 'youtube' | 'maps' | 'flowPrompt' | 'botMessage' | 'emailBody' | 'instructions';

export const PROMPT_AUTHOR_KINDS: readonly PromptAuthorKind[] = ['youtube', 'maps', 'flowPrompt', 'botMessage', 'emailBody', 'instructions'];

/** The kinds that write a flow step's field, with the step's data as `{{…}}` references. */
export const FLOW_DRAFT_KINDS: ReadonlySet<PromptAuthorKind> = new Set<PromptAuthorKind>(['flowPrompt', 'botMessage', 'emailBody']);

/** The longest video or Maps prompt template the app saves or sends for rewriting. */
export const PROMPT_TEMPLATE_MAX_CHARS = 60_000;

/** Every slot a template of each kind may use; the Settings hints list them from here. */
export const PROMPT_PLACEHOLDERS = {
  youtube: ['url', 'transcript', 'language', 'title'],
  maps: ['place', 'reviews', 'language', 'rating', 'total', 'positive', 'distribution', 'verdict'],
} as const satisfies Partial<Record<PromptAuthorKind, readonly string[]>>;

/** One `{{name}}` a flow field may use, with what it holds as the Insert data menu says it. */
export interface PromptDraftVariable {
  name: string;
  hint?: string;
}

/** What the model is told about where the text goes; only the fields of the request's kind are read. */
export interface PromptDraftContext {
  flowName?: string;
  flowDescription?: string;
  stepLabel?: string;
  /** `instructions`: the tone and length chosen beside the field. */
  tone?: string;
  length?: string;
}

export interface PromptAuthorRequest {
  id: string;
  kind: PromptAuthorKind;
  instructions: string;
  currentPrompt: string;
  /** Empty follows the app's current default model. */
  targetUrl: string;
  /** Flow kinds: the data this step can use, from the same catalog as its Insert data menu. */
  variables?: PromptDraftVariable[];
  context?: PromptDraftContext;
}

export type PromptAuthorResult =
  | { ok: true; prompt: string; notes?: string[] }
  | { ok: false; error: string; cancelled?: boolean };

/**
 * The `{{…}}` references in a flow draft that the step cannot fill: not in its catalog and not
 * already in the text it started from (a reference the user wrote themselves stays theirs).
 * Read as the flow interpolator reads them, so the check sees what a run would.
 */
export function unknownDraftVariables(draft: string, variables: readonly PromptDraftVariable[], base: string): string[] {
  const allowed = new Set([...variables.map((variable) => variable.name.trim()), ...extractTemplateVariables(base)]);
  return extractTemplateVariables(draft).filter((name) => !allowed.has(name));
}

/** References the draft added and dropped against the text it started from, for the preview. */
export function draftVariableChanges(base: string, draft: string): { added: string[]; removed: string[] } {
  const before = extractTemplateVariables(base);
  const after = extractTemplateVariables(draft);
  return {
    added: after.filter((name) => !before.includes(name)),
    removed: before.filter((name) => !after.includes(name)),
  };
}
