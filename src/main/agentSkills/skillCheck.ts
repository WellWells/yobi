import type { SkillCheckStep, SkillOtherFile, SkillTextFiles, SkillVerifyReport } from '../../shared/skillAuthoring';
import { lintSkill, runScriptExamples, scriptExamples } from './skillVerify';
import { stageSkillDraft } from './skillTextFiles';

/*
 * One local check of a skill's files — the same for a fresh AI draft and for "check" on any skill:
 * the structure lint, then each script's SKILL.md example run once in a staged copy of the files.
 * No model call.
 */

export interface SkillCheckOptions {
  /** What the AI wrote this time; empty for a skill checked as it is. */
  authored?: ReadonlySet<string>;
  others?: readonly SkillOtherFile[];
  /** The installed skill the files belong to: its other files are staged with them. */
  base?: string;
  signal?: AbortSignal;
  /** The lint's result as soon as it is known, then each example run as it ends. */
  onStep?: (step: SkillCheckStep) => void;
}

export async function checkSkillFiles(files: SkillTextFiles, opts: SkillCheckOptions = {}): Promise<SkillVerifyReport> {
  const issues = lintSkill(files, { authored: opts.authored ?? new Set(), others: (opts.others ?? []).map((file) => file.rel) });
  const examples = scriptExamples(files);
  const total = examples.length;
  opts.onStep?.({ kind: 'lint', errors: issues.filter((entry) => entry.level === 'error').length, runs: total });
  if (total === 0) return { issues, runs: [] };
  const staged = await stageSkillDraft(files, opts.base);
  try {
    const runs = await runScriptExamples(staged.dir, examples, {
      signal: opts.signal,
      onRun: (done, failed) => opts.onStep?.({ kind: 'run', done, total, failed }),
    });
    return { issues, runs };
  } finally {
    await staged.dispose();
  }
}
