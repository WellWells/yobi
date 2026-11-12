import type React from 'react';
import type { FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../../shared/types';
import type { StepDraftButtonRender } from '../StepDraftButton';

export interface SkillConfigProps {
  step: SkillInstance;
  onChange: (config: Record<string, string>) => void;
  t: (k: string) => string;
  /** The flow the step is in, for a form that says where the step sits (`controlFacts`). */
  flowId?: string;
  flowVariables?: FlowVariable[];
  /** The flow's bot trigger when it has one, else its main trigger. */
  flowTrigger?: TriggerConfig;
  /**
   * The card's Insert data menu, for an editor that places it beside its main field. Only the
   * steps in `INSERT_DATA_IN_FORM` do; the card puts it under every other form.
   */
  insertData?: React.ReactNode;
  /** The "Write"/"Rewrite" button for one of the form's text fields, bound to this step. */
  draftButton?: StepDraftButtonRender;
}

/** Steps whose form shows the Insert data menu itself, next to the field it mostly fills. */
export const INSERT_DATA_IN_FORM: ReadonlySet<SkillType> = new Set<SkillType>(['llm']);

/**
 * Steps with no field a `{{…}}` can go into (a menu, a number, a list of fields), or none worth
 * filling (a note, where `{{clipboard}}` would only make a bot-run flow read owner data): no
 * Insert data menu, neither under the form nor on a field's right-click menu.
 */
export const NO_INSERT_DATA: ReadonlySet<SkillType> = new Set<SkillType>(['power', 'delay', 'sysinfo', 'comment', 'telegram_read']);

export type SkillConfigEditor = React.FC<SkillConfigProps>;
export type SkillConfigEditorMap = Record<SkillType, SkillConfigEditor>;
