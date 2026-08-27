import React, { useState } from 'react';
import { ActionIcon, Autocomplete, Badge, Box, Group, Stack, Text } from '@mantine/core';
import { CheckCircle2, KeyRound, ListChecks, Pencil, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { SectionCard, SectionTitle, SelectDropdown, VisibilityToggle } from '../components';
import { useHiddenSources } from '../hooks/useHiddenSources';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { buildInputStyles } from '../../../components/inputStyles';
import { WebDialog } from '../../../components/WebDialog';
import { getByokTypeIcon } from '../../../config/models';
import type { useByokSettings } from '../hooks/useByokSettings';
import { BYOK_MODEL_EXAMPLES, BYOK_PROVIDER_TYPES, BYOK_PROVIDER_TYPE_LABELS } from '../../../../../shared/types';
import type { ByokInstanceSnapshot, ByokProviderType } from '../../../../../shared/types';

const MODEL_INPUT_STYLES = {
  ...buildInputStyles({ tone: 'body', mono: true }),
  dropdown: {
    background: 'var(--mantine-color-bg-tertiary)',
    borderColor: 'var(--mantine-color-default-border)',
  },
  option: { fontSize: 'var(--font-size-base)', fontFamily: 'var(--font-mono)' },
};

type ByokSettings = ReturnType<typeof useByokSettings>;

interface Props {
  byok: ByokSettings;
  t: (key: string) => string;
  sectionGap: number;
}

const PROVIDER_TYPE_OPTIONS = BYOK_PROVIDER_TYPES.map((type) => ({
  value: type,
  label: BYOK_PROVIDER_TYPE_LABELS[type],
}));

function modelPlaceholder(type: ByokProviderType, t: (key: string) => string): string {
  const example = BYOK_MODEL_EXAMPLES[type];
  if (!example) return t('settings.byok.model.placeholder.custom');
  return `${t('settings.byok.model.placeholder.prefix')} ${example}`;
}

export const ByokKeysCard: React.FC<Props> = ({ byok, t, sectionGap }) => {
  const [confirmDelete, setConfirmDelete] = useState<ByokInstanceSnapshot | null>(null);
  const sources = useHiddenSources();
  const instances = byok.snapshot?.instances ?? [];
  const { form } = byok;
  const editingInstance = form?.id ? instances.find((instance) => instance.id === form.id) : undefined;
  const hiddenNow = (id: string): boolean => sources.hidden.byokIds.includes(id);

  return (
    <Box>
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<KeyRound size={15} />} label={t('settings.byok.title')} />
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6} mb={14}>
          {t('settings.byok.hint')}
        </Text>

        {instances.length === 0 && !form && (
          <Text fz="var(--font-size-sm)" c="dimmed" mb={12}>
            {t('settings.byok.empty')}
          </Text>
        )}

        <Stack gap={0}>
          {instances.map((instance, index) => {
            const InstanceIcon = getByokTypeIcon(instance.providerType);
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
                    variant="default"
                    size={30}
                    aria-label={t('settings.byok.edit')}
                    onClick={() => byok.openEdit(instance)}
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
            </Box>
            );
          })}
        </Stack>

        {form ? (
          <Stack
            gap="xs"
            mt={instances.length > 0 ? 12 : 0}
            p={12}
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
            }}
          >
            <Group gap={8} align="flex-end" wrap="nowrap">
              <AppTextInput
                flex={1}
                label={t('settings.byok.name')}
                placeholder={t('settings.byok.name.placeholder')}
                value={form.name}
                onChange={(e) => byok.updateForm({ name: e.target.value })}
                size="sm"
              />
              <SelectDropdown
                label={t('settings.byok.providerType')}
                options={PROVIDER_TYPE_OPTIONS}
                value={form.providerType}
                onChange={(value) => byok.updateForm({ providerType: value as ByokProviderType })}
                size="sm"
              />
            </Group>
            <AppTextInput
              label={t('settings.byok.baseUrl')}
              placeholder={t('settings.byok.baseUrl.placeholder')}
              value={form.baseUrl}
              onChange={(e) => byok.updateForm({ baseUrl: e.target.value })}
              mono
              size="sm"
            />
            <AppPasswordInput
              label={t('settings.byok.apiKey')}
              placeholder={form.id ? t('settings.byok.apiKey.placeholder.keep') : t('settings.byok.apiKey.placeholder')}
              value={form.apiKey}
              onChange={(e) => byok.updateForm({ apiKey: e.target.value })}
              mono
              size="sm"
            />
            {form.id && (
              <Text fz="var(--font-size-sm)" c="dimmed">
                {t('settings.byok.keyCurrent')}:{' '}
                {editingInstance?.hasKey ? editingInstance.keyPreview : t('settings.byok.keyNotSet')}
              </Text>
            )}
            <Box>
              <Group gap={8} align="flex-end" wrap="nowrap">
                <Autocomplete
                  flex={1}
                  label={t('settings.byok.model')}
                  placeholder={modelPlaceholder(form.providerType, t)}
                  value={form.model}
                  onChange={(value) => byok.updateForm({ model: value })}
                  data={byok.models}
                  limit={50}
                  maxDropdownHeight={220}
                  size="sm"
                  styles={MODEL_INPUT_STYLES}
                />
                <AppButton
                  variant="default"
                  size="sm"
                  leftSection={<ListChecks size={13} />}
                  loading={byok.modelsLoading}
                  disabled={!byok.canProbe}
                  onClick={() => { void byok.loadModels(); }}
                >
                  {t('settings.byok.model.load')}
                </AppButton>
              </Group>
              {byok.modelsError === 'EMPTY' && (
                <Text fz="var(--font-size-sm)" c="dimmed" mt={4}>{t('settings.byok.model.loadEmpty')}</Text>
              )}
              {byok.modelsError && byok.modelsError !== 'EMPTY' && (
                <Text fz="var(--font-size-sm)" c="red" mt={4}>{byok.modelsError}</Text>
              )}
              {byok.models.length > 0 && (
                <Text fz="var(--font-size-sm)" c="dimmed" mt={4}>
                  {t('settings.byok.model.loaded').replace('{{count}}', String(byok.models.length))}
                </Text>
              )}
            </Box>
            <Group justify="space-between" gap={8} mt={4} wrap="nowrap">
              <AppButton
                variant="default"
                size="xs"
                leftSection={<Zap size={13} />}
                loading={byok.testStatus === 'testing'}
                disabled={!byok.canTest}
                onClick={() => { void byok.testInstance(); }}
              >
                {t('settings.byok.test')}
              </AppButton>
              <Group gap={8}>
                <AppButton variant="default" size="xs" onClick={byok.closeForm} disabled={byok.busy}>
                  {t('dialog.cancel')}
                </AppButton>
                <AppButton
                  variant="filled"
                  size="xs"
                  leftSection={<KeyRound size={13} />}
                  loading={byok.busy}
                  disabled={!byok.formValid}
                  onClick={() => { void byok.saveForm(); }}
                >
                  {t('settings.byok.save')}
                </AppButton>
              </Group>
            </Group>
            {byok.testStatus === 'ok' && (
              <Group gap={6} align="flex-start" wrap="nowrap">
                <Box c="teal" mt={2} style={{ flexShrink: 0 }}><CheckCircle2 size={14} /></Box>
                <Text fz="var(--font-size-sm)" c="dimmed">
                  {t('settings.byok.test.ok')}
                  {byok.testMessage ? ` — ${byok.testMessage}` : ''}
                </Text>
              </Group>
            )}
            {byok.testStatus === 'error' && (
              <Group gap={6} align="flex-start" wrap="nowrap">
                <Box c="red" mt={2} style={{ flexShrink: 0 }}><XCircle size={14} /></Box>
                <Text fz="var(--font-size-sm)" c="red">{byok.testMessage}</Text>
              </Group>
            )}
          </Stack>
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
