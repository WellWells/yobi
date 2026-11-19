import React, { useState } from 'react';
import { Checkbox, Code, Group, Stack, Text } from '@mantine/core';
import { AppButton } from '../../../components/AppButton';
import { ASSISTANT_TEXT } from '../../../components/AssistantPanel';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { AssistResult } from '../../../store/useFlowAssistStore';
import { applyKeys } from './flowAssistActions';

interface KeysViewProps {
  flowId: string;
  result: Extract<AssistResult, { kind: 'keys' }>;
  t: (key: string) => string;
  onDismiss: () => void;
}

/**
 * The proposed output names, each ticked by default: the new `{{name}}`, then which step and what
 * it replaces, and how many places in the flow read it (all of them follow on Apply).
 */
export const AssistKeysView: React.FC<KeysViewProps> = ({ flowId, result, t, onDismiss }) => {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(result.rows.map((row) => row.stepId)));
  const toggle = (id: string): void => setPicked((before) => {
    const next = new Set(before);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <Stack gap={8} py={4} data-assist-keys="">
      <Text fz={ASSISTANT_TEXT.heading} fw={600}>{t('flow.assist.keys.title')}</Text>
      <Stack gap={6}>
        {result.rows.map((row) => (
          <Checkbox
            key={row.stepId}
            size="sm"
            checked={picked.has(row.stepId)}
            onChange={() => toggle(row.stepId)}
            label={(
              <Stack gap={2}>
                <Group gap={6} wrap="nowrap">
                  <Code fz={ASSISTANT_TEXT.body}>{`{{${row.key}}}`}</Code>
                  <Code fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)" td="line-through">{`{{${row.before}}}`}</Code>
                </Group>
                <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)" lineClamp={1}>
                  {fillTemplate(t(row.references > 0 ? 'flow.assist.keys.row' : 'flow.assist.keys.rowUnused'), {
                    step: `#${row.index} ${row.stepName}`,
                    count: String(row.references),
                  })}
                </Text>
              </Stack>
            )}
          />
        ))}
      </Stack>
      <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)">{t('flow.assist.keys.hint')}</Text>
      {result.skipped > 0 && <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)">{fillTemplate(t('flow.assist.keys.skipped'), { count: String(result.skipped) })}</Text>}
      <Group gap={6}>
        <AppButton size="compact-sm" variant="filled" disabled={picked.size === 0} onClick={() => applyKeys(flowId, [...picked])}>{t('flow.assist.apply')}</AppButton>
        <AppButton size="compact-sm" variant="default" onClick={onDismiss}>{t('flow.assist.discard')}</AppButton>
      </Group>
    </Stack>
  );
};
