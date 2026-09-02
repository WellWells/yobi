import React from 'react';
import { Badge, Checkbox, Group, Stack, Text } from '@mantine/core';
import { Layers } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import type { useByokGroups } from '../hooks/useByokGroups';
import { BYOK_PROVIDER_TYPE_LABELS } from '../../../../../shared/types';

interface Props {
  byokGroups: ReturnType<typeof useByokGroups>;
  t: (key: string) => string;
  mt?: number;
}

/** Add/edit form for one BYOK group; rendered under the edited row, or at the end when adding. */
export const ByokGroupForm: React.FC<Props> = ({ byokGroups, t, mt }) => {
  const { availableKeys, form } = byokGroups;
  if (!form) return null;

  return (
    <Stack
      gap="xs"
      mt={mt}
      p={12}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
    >
      <AppTextInput
        label={t('settings.byok.group.name')}
        placeholder={t('settings.byok.group.name.placeholder')}
        value={form.name}
        onChange={(e) => byokGroups.updateName(e.target.value)}
        size="sm"
      />
      <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" mt={4}>
        {t('settings.byok.group.members')}
      </Text>
      <Text fz="var(--font-size-sm)" c="dimmed" mb={2}>
        {t('settings.byok.group.selectHint')}
      </Text>
      <Stack gap={8}>
        {availableKeys.map((key) => (
          <Checkbox
            key={key.id}
            size="sm"
            checked={form.memberIds.includes(key.id)}
            onChange={() => byokGroups.toggleMember(key.id)}
            label={
              <Group gap={8} wrap="nowrap" align="center">
                <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" truncate>
                  {key.name}
                </Text>
                <Badge variant="light" color="gray" radius="sm" size="sm" tt="none" fw={500}>
                  {BYOK_PROVIDER_TYPE_LABELS[key.providerType]}
                </Badge>
                <Text fz="var(--font-size-sm)" c="dimmed" ff="var(--font-mono)" truncate>
                  {key.model}
                </Text>
              </Group>
            }
          />
        ))}
      </Stack>
      <Group justify="flex-end" gap={8} mt={4} wrap="nowrap">
        <AppButton variant="default" size="xs" onClick={byokGroups.closeForm} disabled={byokGroups.busy}>
          {t('dialog.cancel')}
        </AppButton>
        <AppButton
          variant="filled"
          size="xs"
          leftSection={<Layers size={13} />}
          loading={byokGroups.busy}
          disabled={!byokGroups.formValid}
          onClick={() => { void byokGroups.saveForm(); }}
        >
          {t('settings.byok.group.save')}
        </AppButton>
      </Group>
    </Stack>
  );
};
