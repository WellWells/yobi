import type { BotPlatform, FlowVariable, SkillInstance, TriggerConfig } from '../../../../../shared/types';

/**
 * - `unset`: a field the step needs is empty (`primary` says which).
 * - `warning`: it runs, but not the way it reads (an empty clipboard write, `continue` as a loop's last step).
 * - `error`: it cannot run as written (a reference to nothing, an unpaired end marker).
 */
export type StepSummaryState = 'unset' | 'ok' | 'error' | 'warning';

export interface StepSummary {
  /** The row's main text: what the step does, for a step the user has not named. */
  primary: string;
  /** The quieter second line: where its input comes from, where it goes, its output name. */
  secondary?: string;
  /** `primary` is code or a target read character by character (monospace). */
  code?: boolean;
  /** `secondary` is code (a shell command under a name the user gave). */
  secondaryCode?: boolean;
  state: StepSummaryState;
  /** Why the state is `error` or `warning`; the outline shows it in place of `secondary`. */
  issue?: string;
}

/**
 * Names the summary cannot know by itself. Each is optional: without it a chat, calendar or
 * connector reads as a count or its own words, never as an ID.
 */
export interface StepSummaryLookup {
  /** A paired chat's or LINE chat's name by its ID; undefined when this computer does not know it. */
  chatName?: (platform: BotPlatform, id: string) => string | undefined;
  /** A calendar's name by its stored id; undefined when it is not on this computer. */
  calendarName?: (id: string) => string | undefined;
  /** A connector's name as Settings shows it. */
  mcpServerName?: (server: string) => string | undefined;
  /** A connector tool's title. */
  mcpToolTitle?: (server: string, tool: string) => string | undefined;
}

export interface StepSummaryContext {
  t: (key: string) => string;
  /** The step's 0-based position in `steps`. */
  index: number;
  /** The whole flow: earlier steps for references and scope, later ones for what is left to run. */
  steps: readonly SkillInstance[];
  /**
   * The model a step names (an AI step's `provider`, a video step's fallback key), as the model
   * picker shows it; undefined when it names none, or names a key this computer no longer has.
   */
  modelLabel?: (step: SkillInstance) => string | undefined;
  variables?: readonly FlowVariable[];
  /** Every trigger of the flow; when given, `{{input}}`, `{{selection}}` and `{{bot.*}}` are checked against them. */
  triggers?: readonly TriggerConfig[];
  /** The interface language, for language names and numbers. Defaults to en-US. */
  locale?: string;
  lookup?: StepSummaryLookup;
}

export type Summarizer = (step: SkillInstance, ctx: StepSummaryContext) => StepSummary;
