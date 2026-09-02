import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { SectionCard, SectionTitle, VisibilityToggle } from '../components';
import { useHiddenSources } from '../hooks/useHiddenSources';
import { AppButton } from '../../../components/AppButton';
import { WebDialog } from '../../../components/WebDialog';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { getByokTypeIcon } from '../../../config/models';
import { ByokKeyForm } from './ByokKeyForm';
import type { useByokSettings } from '../hooks/useByokSettings';
import { BYOK_PROVIDER_TYPE_LABELS } from '../../../../../shared/types';
import type { ByokInstanceSnapshot } from '../../../../../shared/types';

type ByokSettings = ReturnType<typeof useByokSettings>;

interface Props {
  byok: ByokSettings;
  t: (key: string) => string;
  sectionGap: number;
}

export const ByokKeysCard: React.FC<Props> = ({ byok, t, sectionGap }) => {
  const [confirmDelete, setConfirmDelete] = useState<ByokInstanceSnapshot | null>(null);
  const sources = useHiddenSources();
  const instances = byok.snapshot?.instances ?? [];
  const { form } = byok;
  const addingNew = form !== null && form.id === null;
  const hiddenNow = (id: string): boolean => sources.hidden.byokIds.includes(id);

  return (
    <Box>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<KeyRound size={15} />} label={t('settings.byok.title')} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
          {t('settings.byok.hint')}
        </Text>

        <SecretHealthAlert scopes={['byok']} />

        {instances.length === 0 && !form && (
          <Text fz="var(--font-size-sm)" c="dimmed" mb={12}>
            {t('settings.byok.empty')}
          </Text>
        )}

        <Stack gap={0}>
          {instances.map((instance, index) => {
            const InstanceIcon = getByokTypeIcon(instance.providerType);
            const editingThis = form?.id === instance.id;
            return (
            <Box
              key={instance.id}
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
                  opacity={hiddenNow(instance.id) ? 0.55 : 1}
                >
                  <Box c="var(--mantine-color-default-color)" mt={2} style={{ flexShrink: 0 }}>
                    <InstanceIcon size={16} />
                  </Box>
                  <Stack gap={4} miw={0}>
                    <Group gap={8} wrap="nowrap">
                      <Text fz="var(--font-size-base)" fw={600} c="var(--mantine-color-default-color)" truncate>
                        {instance.name}
                      </Text>
                      <Badge variant="light" color="gray" radius="sm" size="sm" tt="none" fw={500}>
                        {BYOK_PROVIDER_TYPE_LABELS[instance.providerType]}
                      </Badge>
                    </Group>
                    <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5} truncate>
                      {instance.model}
                      {' · '}
                      {instance.hasKey ? instance.keyPreview : t('settings.byok.keyNotSet')}
                    </Text>
                  </Stack>
                </Group>

                <Group gap={6} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
                  <ActionIcon
                    variant={editingThis ? 'light' : 'default'}
                    size={30}
                    aria-label={t('settings.byok.edit')}
                    onClick={() => (editingThis ? byok.closeForm() : byok.openEdit(instance))}
                  >
                    <Pencil size={14} />
                  </ActionIcon>
                  <ActionIcon
                    variant="default"
                    size={30}
                    c="red"
                    aria-label={t('settings.byok.delete')}
                    onClick={() => setConfirmDelete(instance)}
                  >
                    <Trash2 size={14} />
                  </ActionIcon>
                  <VisibilityToggle
                    label={instance.name}
                    checked={!hiddenNow(instance.id)}
                    blocked={!hiddenNow(instance.id) && !sources.canApply({
                      ...sources.hidden,
                      byokIds: [...sources.hidden.byokIds, instance.id],
                    })}
                    busy={sources.busy}
                    onToggle={() => sources.toggleByok(instance.id)}
                    t={t}
                  />
                </Group>
              </Group>

              {editingThis && <ByokKeyForm byok={byok} t={t} mt={12} />}
            </Box>
            );
          })}
        </Stack>

        {addingNew ? (
          <ByokKeyForm byok={byok} t={t} mt={instances.length > 0 ? 12 : 0} />
        ) : (
          <Group mt={instances.length > 0 ? 12 : 0}>
            <AppButton
              variant="default"
              size="xs"
              leftSection={<Plus size={13} />}
              onClick={byok.openAdd}
            >
              {t('settings.byok.add')}
            </AppButton>
          </Group>
        )}
      </SectionCard>

      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.byok.delete.confirm.title').replace('{{name}}', confirmDelete?.name ?? '')}
        description={t('settings.byok.delete.confirm.detail')}
        confirmText={t('settings.byok.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const instance = confirmDelete;
          setConfirmDelete(null);
          if (instance) void byok.deleteInstance(instance.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
