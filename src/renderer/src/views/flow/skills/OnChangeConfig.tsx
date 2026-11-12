import React, { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { StatusLine } from '../../../components/StatusLine';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillConfigProps } from './types';
import { onChangeFacts, useSavedField, useStepFacts, type OnChangeFacts } from './controlFacts';

const NO_FACTS: OnChangeFacts = { stopAt: 0, stopInLoop: false };

/** What happens when the value did not change, said by the step that follows. */
function stopHint(facts: OnChangeFacts, t: (k: string) => string): string {
  if (!facts.stopAt) return t('flow.skill.on_change.hint.noStop');
  const step = `#${facts.stopAt}`;
  return fillTemplate(t(facts.stopInLoop ? 'flow.skill.on_change.hint.skipsItem' : 'flow.skill.on_change.hint.stopsRun'), { step });
}

export const OnChangeConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowId }) => {
  const value = step.config.value ?? '';
  const facts = useStepFacts(flowId, step.id, onChangeFacts, NO_FACTS);
  const savedValue = useSavedField(flowId, step.id, 'value');
  // Said once the field is left: while typing every key would flip it.
  const [left, setLeft] = useState(false);
  const differsFromSaved = left && savedValue !== null && savedValue !== value;

  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <AppTextarea
          label={t('flow.skill.on_change.value')}
          placeholder={t('flow.skill.on_change.value.placeholder')}
          value={value}
          onChange={(e) => onChange({ ...step.config, value: e.currentTarget.value })}
          onFocus={() => setLeft(false)}
          onBlur={() => setLeft(true)}
          minRows={1}
          maxRows={6}
          autosize
          size="sm"
        />
        {differsFromSaved && <StatusLine tone="warning">{t('flow.skill.on_change.value.changedSinceSave')}</StatusLine>}
      </Stack>
      <SettingRow
        label={t('flow.skill.on_change.withDiff')}
        hint={fillTemplate(t('flow.skill.on_change.withDiff.hint'), { diff: `{{${step.outputKey}.diff}}` })}
        control={
          <ToggleSwitch
            checked={step.config.withDiff === 'true'}
            onChange={(e) => onChange({ ...step.config, withDiff: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.on_change.hint.remember')}</Text>
      <Text fz="xs" c="var(--text-muted)" data-on-change-stop="">{stopHint(facts, t)}</Text>
    </Stack>
  );
};
