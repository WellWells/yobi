import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { StatusLine } from '../../../components/StatusLine';
import { useFlowStore } from '../../../store/useFlowStore';
import { describeRef } from '../stepSummary';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { FlowDefinition } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

export type DeleteScope = 'made' | 'fixed' | 'each';

const WHOLE_REF = /^\{\{\s*[^{}]+?\s*\}\}$/;

/**
 * What a delete step reaches, by how its path is written and where that comes from — the same
 * reading as its summary line: a file this run made (a reference), one fixed file (a literal
 * path), or every item of a loop (the loop's item: a whole folder's files, one by one).
 */
export function deleteScopeOf(
  flow: Pick<FlowDefinition, 'steps' | 'trigger' | 'extraTriggers' | 'variables'>,
  stepId: string,
  t: (key: string) => string,
): { scope: DeleteScope; text: string } | null {
  const index = flow.steps.findIndex((s) => s.id === stepId);
  const raw = (flow.steps[index]?.config.path ?? '').trim();
  if (index < 0 || !raw) return null;
  if (!WHOLE_REF.test(raw)) return { scope: 'fixed', text: t('flow.summary.delete.fixed') };
  const described = describeRef(raw, {
    t, index, steps: flow.steps, variables: flow.variables ?? [], triggers: [flow.trigger, ...(flow.extraTriggers ?? [])],
  });
  if (described.kind === 'loop') return { scope: 'each', text: fillTemplate(t('flow.summary.delete.each'), { step: described.text }) };
  return { scope: 'made', text: t('flow.summary.delete.made') };
}

/** A literal path ending in a separator names a folder, which this step never deletes. */
export function namesFolder(raw: string): boolean {
  const value = raw.trim();
  return !value.includes('{{') && /[\\/]$/.test(value);
}

export const FileDeleteConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  // One string, so the card draws again only when the reach changes.
  const reach = useFlowStore((s) => {
    const flow = s.flows.find((f) => f.id === s.selectedFlowId);
    const found = flow ? deleteScopeOf(flow, step.id, t) : null;
    return found ? `${found.scope}\n${found.text}` : '';
  });
  const [scope, text] = reach ? (reach.split('\n') as [DeleteScope, string]) : [null, ''];
  const path = step.config.path ?? '';
  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.file_delete.path')}
        placeholder={t('flow.skill.file_delete.path.placeholder')}
        value={path}
        onChange={(e) => onChange({ ...step.config, path: e.currentTarget.value })}
        error={namesFolder(path) ? t('flow.skill.file_delete.folderError') : undefined}
        size="sm"
        mono
      />
      {/* What it reaches is shown, not tucked in a tooltip: a delete's reach must not hide. */}
      {scope && (scope === 'made'
        ? <Text fz="xs" c="var(--text-muted)">{text}</Text>
        : <StatusLine tone="warning">{text}</StatusLine>)}
      <Text fz="xs" c="dimmed">{t('flow.skill.file_delete.hint')}</Text>
    </Stack>
  );
};
