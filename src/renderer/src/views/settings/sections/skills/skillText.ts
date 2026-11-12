import { fillTemplate } from '../../../../../../shared/fillTemplate';
import type { SkillIssue, SkillRuntime, SkillSaveResult } from '../../../../../../shared/agentSkills';
import type { ScriptRunResult, SkillCheckIssue } from '../../../../../../shared/skillAuthoring';

type T = (key: string) => string;

/** One problem with a skill, in the user's words; `detail` is a name, a path or a number. */
export function skillIssueText(issue: SkillIssue | Extract<SkillSaveResult, { ok: false }>['issue'], t: T): string {
  // Built-in skills keep their copy under their own heading.
  if (issue.code === 'bundledName') return fillTemplate(t('settings.skills.bundled.reservedName'), { detail: issue.detail ?? '' });
  if (issue.code === 'bundledRename') return t('settings.skills.bundled.noRename');
  return fillTemplate(t(`settings.skills.issue.${issue.code}`), { detail: issue.detail ?? '' });
}

/** The variant of a check's wording: a missing file with no detail is SKILL.md itself. */
function checkKey(issue: SkillCheckIssue): string {
  if (issue.code === 'missingFile' && !issue.detail) return 'missingFile.self';
  return issue.code;
}

/** One finding of the local checks; a broken SKILL.md header reads as the import's own issue text. */
export function skillCheckText(issue: SkillCheckIssue, t: T): string {
  if (issue.code === 'skillMd' && issue.detail) return skillIssueText({ code: issue.detail } as SkillIssue, t);
  return fillTemplate(t(`settings.skills.check.${checkKey(issue)}`), { file: issue.file ?? '', detail: issue.detail ?? '' });
}

/** How an example run ended, when it did not end well. */
export function runFailureText(run: ScriptRunResult, t: T): string {
  if (run.timedOut) return t('settings.skills.run.timeout');
  if (run.exitCode === null) return t('settings.skills.run.crashed');
  return fillTemplate(t('settings.skills.run.exit'), { code: String(run.exitCode) });
}

const RUNTIME_LABEL: Record<SkillRuntime, string> = {
  python: 'Python',
  node: 'Node.js',
  shell: 'sh',
  powershell: 'PowerShell',
  batch: 'cmd',
};

/** What a skill's scripts need installed, as program names (not translated). */
export function runtimeLabels(needs: readonly SkillRuntime[]): string[] {
  return needs.map((need) => RUNTIME_LABEL[need]);
}
