import React from 'react';
import { Button, Group, Menu, Pill, Stack, Text } from '@mantine/core';
import { Plus } from 'lucide-react';
import {
  SYSINFO_CATEGORY_ORDER,
  SYSINFO_FIELDS,
  resolveSysInfoSelection,
} from '../../../../../shared/sysinfoFields';
import { PROVIDER_DROPDOWN_MAX_HEIGHT } from '../../../config/models';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

export const SysInfoConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const selected = resolveSysInfoSelection(step.config);
  const selectedSet = new Set(selected);
  const fieldLabel = (key: string): string => t(`flow.skill.sysinfo.field.${key}`);

  const writeSelection = (keys: string[]): void => {
    const next: Record<string, string> = { ...step.config, fields: keys.join(',') };
    delete next.includeGpu;
    delete next.includePublicIp;
    onChange(next);
  };

  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('flow.skill.sysinfo.format')}
        options={[
          { value: 'text', label: t('flow.skill.sysinfo.format.text') },
          { value: 'json', label: t('flow.skill.sysinfo.format.json') },
        ]}
        value={step.config.format ?? 'text'}
        onChange={(value) => onChange({ ...step.config, format: value })}
        size="sm"
      />

      <Stack gap={6}>
        <Group justify="space-between" align="center">
          <Text fz="xs" c="dimmed">{t('flow.skill.sysinfo.fields')}</Text>
          <Menu
            position="bottom-end"
            withinPortal
            styles={{ dropdown: { maxHeight: PROVIDER_DROPDOWN_MAX_HEIGHT, overflowY: 'auto' } }}
          >
            <Menu.Target>
              <Button variant="light" size="xs" leftSection={<Plus size={13} />}>
                {t('flow.skill.sysinfo.addField')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {SYSINFO_CATEGORY_ORDER.map((category) => {
                const items = SYSINFO_FIELDS.filter(
                  (f) => f.category === category && !selectedSet.has(f.key),
                );
                if (items.length === 0) return null;
                return (
                  <React.Fragment key={category}>
                    <Menu.Label>{t(`flow.skill.sysinfo.category.${category}`)}</Menu.Label>
                    {items.map((f) => (
                      <Menu.Item key={f.key} onClick={() => writeSelection([...selected, f.key])}>
                        {fieldLabel(f.key)}
                      </Menu.Item>
                    ))}
                  </React.Fragment>
                );
              })}
              {selected.length === SYSINFO_FIELDS.length && (
                <Menu.Item disabled>{t('flow.skill.sysinfo.allAdded')}</Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>

        {selected.length > 0 ? (
          <Pill.Group>
            {selected.map((key) => (
              <Pill
                key={key}
                withRemoveButton
                onRemove={() => writeSelection(selected.filter((k) => k !== key))}
              >
                {fieldLabel(key)}
              </Pill>
            ))}
          </Pill.Group>
        ) : (
          <Text fz="xs" c="dimmed">{t('flow.skill.sysinfo.fields.empty')}</Text>
        )}
      </Stack>

      <Text fz="xs" c="dimmed">
        {t('flow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
