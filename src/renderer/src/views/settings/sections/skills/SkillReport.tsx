import React from 'react';
import { Code, Group, Stack, Text } from '@mantine/core';
import { ListChecks, Sparkles } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { GroupHeader, StatusLine } from '../../components';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import { scriptCommandLine } from '../../../../../../shared/skillAuthoring';
import type { ScriptRunResult, SkillVerifyReport } from '../../../../../../shared/skillAuthoring';
import { runFailureText, skillCheckText } from './skillText';

type T = (key: string) => string;

interface Props {
  report: SkillVerifyReport | null;
  /** Model calls the last draft spent; null when the files were not drafted here. */
  calls: number | null;
  testing: boolean;
  onTest: () => void;
  /** "Ask AI to fix": one revise call with what the checks found. */
  onFix: () => void;
  /** Another model call is running, or there is no model to ask. */
  fixDisabled: boolean;
  t: T;
}

/** Lines of a run's output shown: enough to read the values, without a scroll box inside the dialog. */
const OUTPUT_LINES = 8;

function outputShown(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
  return lines.length > OUTPUT_LINES ? `${lines.slice(0, OUTPUT_LINES).join('\n')}\n…` : lines.join('\n');
}

function summary(report: SkillVerifyReport, calls: number | null, t: T): string {
  const passed = report.runs.filter((run) => run.ok).length;
  const parts = [
    report.runs.length > 0
      ? fillTemplate(t('settings.skills.report.runs'), { passed: String(passed), total: String(report.runs.length) })
      : t('settings.skills.report.noRuns'),
  ];
  if (calls !== null) parts.push(fillTemplate(t('settings.skills.report.calls'), { count: String(calls) }));
  return parts.join(' · ');
}

/** Whether there is something for "fix" to send: an error, a script with no example, or a failed run. */
export function reportHasProblems(report: SkillVerifyReport | null): boolean {
  if (!report) return false;
  return report.issues.some((issue) => issue.level === 'error' || issue.code === 'noExample') || report.runs.some((run) => !run.ok);
}

const Run: React.FC<{ run: ScriptRunResult; t: T }> = ({ run, t }) => {
  const command = scriptCommandLine(run.script, run.args);
  const output = run.ok ? run.stdout || run.stderr : run.stderr || run.stdout;
  return (
    <Stack gap={4}>
      <StatusLine tone={run.ok ? 'success' : 'error'}>
        {run.ok ? command : fillTemplate(t('settings.skills.run.failed'), { command, reason: runFailureText(run, t) })}
      </StatusLine>
      {output.trim()
        ? <Code block fz="var(--font-size-xs)" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{outputShown(output)}</Code>
        : <Text fz="var(--font-size-xs)" c="var(--text-muted)">{t('settings.skills.run.noOutput')}</Text>}
    </Stack>
  );
};

/**
 * What the checks on this computer found (no model call): problems with the files, then each
 * script run once with the example its SKILL.md gives, and what it printed — the user reads the
 * values. "Ask AI to fix" is one revise call with those findings; nothing is fixed unasked.
 */
export const SkillReport: React.FC<Props> = ({ report, calls, testing, onTest, onFix, fixDisabled, t }) => {
  const problems = reportHasProblems(report);
  const clean = report !== null && report.issues.length === 0 && report.runs.every((run) => run.ok);
  return (
    <Stack gap={10}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <GroupHeader variant="plain" label={t('settings.skills.report')} />
        <AppButton variant="subtle" size="compact-xs" loading={testing} leftSection={<ListChecks size={12} />} onClick={onTest}>
          {t('settings.skills.report.run')}
        </AppButton>
      </Group>
      {report ? (
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{summary(report, calls, t)}</Text>
      ) : (
        <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('settings.skills.report.notRun')}</Text>
      )}
      {clean && <StatusLine tone="success">{t('settings.skills.report.clean')}</StatusLine>}
      {report?.issues.map((issue) => (
        <StatusLine key={`${issue.code}:${issue.file ?? ''}:${issue.detail ?? ''}`} tone={issue.level === 'error' ? 'error' : 'warning'}>
          {skillCheckText(issue, t)}
        </StatusLine>
      ))}
      {report?.runs.map((run) => <Run key={`${run.script}:${run.args.join(' ')}`} run={run} t={t} />)}
      {problems && (
        <Group>
          <AppButton size="xs" variant="light" disabled={fixDisabled} leftSection={<Sparkles size={13} />} onClick={onFix}>
            {t('settings.skills.report.fix')}
          </AppButton>
        </Group>
      )}
    </Stack>
  );
};
