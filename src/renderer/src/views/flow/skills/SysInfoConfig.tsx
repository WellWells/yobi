import React from 'react';
import { Group, Input, Menu, Pill, Stack, Text } from '@mantine/core';
import { Plus } from 'lucide-react';
import {
  SYSINFO_CATEGORY_ORDER,
  SYSINFO_FIELDS,
  SYSINFO_PROBE_FIELDS,
  resolveSysInfoSelection,
} from '../../../../../shared/sysinfoFields';
import { PROVIDER_DROPDOWN_MAX_HEIGHT } from '../../../config/models';
import { AppButton } from '../../../components/AppButton';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

/** What a field costs beyond reading this computer: a request to the internet, or a slower probe. */
export function sysinfoFieldCost(key: string): 'online' | 'slow' | null {
  if (key === 'publicIp') return 'online';
  return SYSINFO_PROBE_FIELDS.has(key) ? 'slow' : null;
}

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
      <Stack gap={6}>
        <Group justify="space-between" align="center">
          <Input.Label>{t('flow.skill.sysinfo.fields')}</Input.Label>
          <Menu
            position="bottom-end"
            withinPortal
            styles={{ dropdown: { maxHeight: PROVIDER_DROPDOWN_MAX_HEIGHT, overflowY: 'auto' } }}
          >
            <Menu.Target>
              <AppButton variant="light" size="xs" leftSection={<Plus size={13} />}>
                {t('flow.skill.sysinfo.addField')}
              </AppButton>
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
                    {items.map((f) => {
                      const cost = sysinfoFieldCost(f.key);
                      return (
                        <Menu.Item
                          key={f.key}
                          onClick={() => writeSelection([...selected, f.key])}
                          rightSection={cost ? (
                            <Text fz="xs" c="var(--text-muted)" data-field-cost={cost}>{t(`flow.skill.sysinfo.cost.${cost}`)}</Text>
                          ) : undefined}
                        >
                          {fieldLabel(f.key)}
                        </Menu.Item>
                      );
                    })}
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
                withRemoveButton={selected.length > 1}
                onRemove={() => writeSelection(selected.filter((k) => k !== key))}
              >
                {fieldLabel(key)}
              </Pill>
            ))}
          </Pill.Group>
        ) : (
          <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.sysinfo.fields.empty')}</Text>
        )}
      </Stack>

      <Input.Wrapper label={t('flow.skill.sysinfo.format')}>
        <AppSegmentedControl
          value={step.config.format === 'json' ? 'json' : 'text'}
          onChange={(value) => onChange({ ...step.config, format: value })}
          options={[
            { value: 'text', label: t('flow.skill.sysinfo.format.text') },
            { value: 'json', label: t('flow.skill.sysinfo.format.json') },
          ]}
          size="sm"
        />
      </Input.Wrapper>

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.browser.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
        {selected[0] ? fillTemplate(t('flow.skill.sysinfo.fieldHint'), { token: `{{${step.outputKey}.${selected[0]}}}` }) : ''}
      </Text>
    </Stack>
  );
};
