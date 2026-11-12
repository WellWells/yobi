import { SKILL_FILE } from '../../../../../../shared/agentSkills';
import type { SkillTextFiles } from '../../../../../../shared/skillAuthoring';
import type { SkillAiMode } from './SkillAiBar';

/** Which skill the editor has open; see `SkillEditorModal`. */
export type SkillEditKind = 'edit' | 'new' | 'conversation';

const FILE_RANK = [/^SKILL\.md$/, /^scripts\//, /^references\//, /^evals\//] as const;

function rank(rel: string): number {
  const at = FILE_RANK.findIndex((pattern) => pattern.test(rel));
  return at < 0 ? FILE_RANK.length : at;
}

/** The order the editor shows a skill's files in: the instructions, then scripts, references and tests. */
export function fileOrder(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Whether the editor still holds what it opened with (the template, or nothing yet). Only then
 * does a draft go straight in; anything else (the user's typing or an earlier draft) is revised,
 * and the change is shown file by file to apply or discard.
 */
export function isPristineFiles(files: SkillTextFiles, openedWith: SkillTextFiles): boolean {
  if (Object.values(files).every((text) => !text.trim())) return true;
  const paths = Object.keys(files);
  return paths.length === Object.keys(openedWith).length && paths.every((rel) => files[rel] === openedWith[rel]);
}

/** What the AI row does next: write from the user's words or the conversation, or revise what is there. */
export function skillAiMode(kind: SkillEditKind, files: SkillTextFiles, openedWith: SkillTextFiles): SkillAiMode {
  if (kind === 'edit' || !isPristineFiles(files, openedWith)) return 'revise';
  return kind === 'conversation' ? 'conversation' : 'new';
}

/** The editor's files with a draft's `changed` files taken over; files the draft did not touch stay as typed. */
export function applyDraft(current: SkillTextFiles, draft: SkillTextFiles, changed: readonly string[]): SkillTextFiles {
  const next = { ...current };
  for (const rel of changed) {
    if (draft[rel] !== undefined) next[rel] = draft[rel];
  }
  return next;
}

/** Whether the files have a script: then the try says whether the agent ran one. */
export function hasScripts(files: SkillTextFiles): boolean {
  return Object.keys(files).some((rel) => rel.startsWith('scripts/'));
}

/** The tab to show: the one asked for while it exists, else the instructions. */
export function activeFile(files: SkillTextFiles, wanted: string): string {
  return files[wanted] !== undefined ? wanted : SKILL_FILE;
}
