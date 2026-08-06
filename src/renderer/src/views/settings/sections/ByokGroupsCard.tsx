import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Checkbox, Group, Stack, Text } from '@mantine/core';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { SectionCard, SectionTitle, VisibilityToggle } from '../components';
import { useHiddenSources } from '../hooks/useHiddenSources';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { WebDialog } from '../../../components/WebDialog';
import type { useByokGroups } from '../hooks/useByokGroups';
import { BYOK_PROVIDER_TYPE_LABELS } from '../../../../../shared/types';
import type { ByokGroupSnapshot } from '../../../../../shared/types';

type ByokGroups = ReturnType<typeof useByokGroups>;

interface Props {
  byokGroups: ByokGroups;
  t: (key: string) => string;
  sectionGap: number;
}

export const ByokGroupsCard: React.FC<Props> = ({ byokGroups, t, sectionGap }) => {
  const [confirmDelete, setConfirmDelete] = useState<ByokGroupSnapshot | null>(null);
  const sources = useHiddenSources();
  const { groups, availableKeys, form } = byokGroups;

  const keyName = (id: string): string =>
    availableKeys.find((key) => key.id === id)?.name ?? id;
  const hiddenNow = (id: string): boolean => sources.hidden.byokGroupIds.includes(id);

  return (
    <Box>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Layers size={15} />} label={t('settings.byok.group.title')} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
          {t('settings.byok.group.hint')}
        </Text>

        {availableKeys.length === 0 ? (
          <Text fz="var(--font-size-sm)" c="dimmed">
            {t('settings.byok.group.needKeys')}
          </Text>
        ) : (
          <>
            {groups.length === 0 && !form && (
              <Text fz="var(--font-size-sm)" c="dimmed" mb={12}>
                {t('settings.byok.group.empty')}
              </Text>
            )}

            <Stack gap={0}>
              {groups.map((group, index) => (
                <Box
                  key={group.id}
                  py={12}
                  style={index > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}
                >
                  <Group justify="space-between" align="center" wrap="nowrap" gap={12}>
                    <Group
                      gap={10}
                      align="flex-start"
                      wrap="nowrap"
                      flex={1}
                      miw={0}
                      opacity={hiddenNow(group.id) ? 0.55 : 1}
                    >
                      <Box c="var(--mantine-color-default-color)" mt={2} style={{ flexShrink: 0 }}>
                        <Layers size={16} />
                      </Box>
                      <Stack gap={6} miw={0}>
                        <Group gap={8} wrap="nowrap">
                          <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)" truncate>
                            {group.name}
                          </Text>
                          <Badge variant="light" color="gray" radius="sm" size="sm" tt="none" fw={500}>
                            {t('settings.byok.group.memberCount').replace('{{count}}', String(group.memberIds.length))}
                          </Badge>
                        </Group>
                        <Group gap={6} wrap="wrap">
                          {group.memberIds.map((id) => (
                            <Badge key={id} variant="default" radius="sm" size="sm" tt="none" fw={500}>
                              {keyName(id)}
                            </Badge>
                          ))}
                        </Group>
                      </Stack>
                    </Group>

                    <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                      <ActionIcon
                        variant="default"
                        size={30}
                        aria-label={t('settings.byok.group.edit')}
                        onClick={() => byokGroups.openEdit(group)}
                      >
                        <Pencil size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="default"
                        size={30}
                        c="red"
                        aria-label={t('settings.byok.group.delete')}
                        onClick={() => setConfirmDelete(group)}
                      >
                        <Trash2 size={14} />
                      </ActionIcon>
                      <VisibilityToggle
                        label={group.name}
                        checked={!hiddenNow(group.id)}
                        blocked={!hiddenNow(group.id) && !sources.canApply({
                          ...sources.hidden,
                          byokGroupIds: [...sources.hidden.byokGroupIds, group.id],
                        })}
                        busy={sources.busy}
                        onToggle={() => sources.toggleByokGroup(group.id)}
                        t={t}
                      />
                    </Group>
                  </Group>
                </Box>
              ))}
            </Stack>

            {form ? (
              <Stack
                gap="xs"
                mt={groups.length > 0 ? 12 : 0}
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
            ) : (
              <Group mt={groups.length > 0 ? 12 : 0}>
                <AppButton
                  variant="default"
                  size="xs"
                  leftSection={<Plus size={13} />}
                  onClick={byokGroups.openAdd}
                >
                  {t('settings.byok.group.add')}
                </AppButton>
              </Group>
            )}
          </>
        )}
      </SectionCard>

      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.byok.group.delete.confirm.title').replace('{{name}}', confirmDelete?.name ?? '')}
        description={t('settings.byok.group.delete.confirm.detail')}
        confirmText={t('settings.byok.group.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const group = confirmDelete;
          setConfirmDelete(null);
          if (group) void byokGroups.deleteGroup(group.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
