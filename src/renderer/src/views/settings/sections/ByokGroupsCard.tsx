import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { SectionCard, SectionTitle, VisibilityToggle } from '../components';
import { useHiddenSources } from '../hooks/useHiddenSources';
import { AppButton } from '../../../components/AppButton';
import { WebDialog } from '../../../components/WebDialog';
import { ByokGroupForm } from './ByokGroupForm';
import type { useByokGroups } from '../hooks/useByokGroups';
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
  const addingNew = form !== null && form.id === null;

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
              {groups.map((group, index) => {
                const editingThis = form?.id === group.id;
                return (
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
                        variant={editingThis ? 'light' : 'default'}
                        size={30}
                        aria-label={t('settings.byok.group.edit')}
                        onClick={() => (editingThis ? byokGroups.closeForm() : byokGroups.openEdit(group))}
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

                  {editingThis && <ByokGroupForm byokGroups={byokGroups} t={t} mt={12} />}
                </Box>
                );
              })}
            </Stack>

            {addingNew ? (
              <ByokGroupForm byokGroups={byokGroups} t={t} mt={groups.length > 0 ? 12 : 0} />
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
