import React from 'react';
import { Anchor, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { isValidUrlOrVar } from './validation';
import { useTabUsers } from './browserTabs';
import { locateStep } from '../outline/locateStep';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

export const BrowserOpenConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const users = useTabUsers(step.id, t);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.browser_open.url')}
        placeholder={t('flow.skill.browser_open.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        mono
        error={isValidUrlOrVar(url) ? undefined : t('flow.skill.browser.url.error')}
      />

      <SettingRow
        label={t('flow.skill.browser_open.show')}
        hint={t('flow.skill.browser_open.show.hint')}
        control={
          <ToggleSwitch
            checked={step.config.show === 'true'}
            onChange={(e) => onChange({ ...step.config, show: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      {/* The steps that work on this tab, each a jump to its card: a tab is named only by text. */}
      <Group gap={6} wrap="wrap" data-tab-users="">
        <Text fz="xs" c="var(--text-muted)">{t('flow.skill.browser_open.usedBy')}</Text>
        {users.length === 0
          ? <Text fz="xs" c="var(--text-muted)">{t('flow.skill.browser_open.usedBy.none')}</Text>
          : users.map((user) => (
            <Anchor
              key={user.stepId}
              component="button"
              type="button"
              fz="xs"
              onClick={() => locateStep(user.stepId, { focus: true })}
            >
              {`#${user.number} ${user.name}`}
            </Anchor>
          ))}
      </Group>

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.browser_open.hint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
