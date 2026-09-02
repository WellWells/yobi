import React from 'react';
import { Autocomplete, Box, Group, Stack, Text } from '@mantine/core';
import { CheckCircle2, KeyRound, ListChecks, XCircle, Zap } from 'lucide-react';
import { SelectDropdown } from '../components';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { buildInputStyles } from '../../../components/inputStyles';
import type { useByokSettings } from '../hooks/useByokSettings';
import { BYOK_MODEL_EXAMPLES, BYOK_PROVIDER_TYPES, BYOK_PROVIDER_TYPE_LABELS } from '../../../../../shared/types';
import type { ByokProviderType } from '../../../../../shared/types';

const MODEL_INPUT_STYLES = {
  ...buildInputStyles({ tone: 'body', mono: true }),
  dropdown: {
    background: 'var(--mantine-color-bg-tertiary)',
    borderColor: 'var(--mantine-color-default-border)',
  },
  option: { fontSize: 'var(--font-size-base)', fontFamily: 'var(--font-mono)' },
};

const PROVIDER_TYPE_OPTIONS = BYOK_PROVIDER_TYPES.map((type) => ({
  value: type,
  label: BYOK_PROVIDER_TYPE_LABELS[type],
}));

function modelPlaceholder(type: ByokProviderType, t: (key: string) => string): string {
  const example = BYOK_MODEL_EXAMPLES[type];
  if (!example) return t('settings.byok.model.placeholder.custom');
  return `${t('settings.byok.model.placeholder.prefix')} ${example}`;
}

interface Props {
  byok: ReturnType<typeof useByokSettings>;
  t: (key: string) => string;
  mt?: number;
}

/** Add/edit form for one BYOK key; rendered under the edited row, or at the end when adding. */
export const ByokKeyForm: React.FC<Props> = ({ byok, t, mt }) => {
  const { form } = byok;
  if (!form) return null;

  const editingInstance = form.id
    ? byok.snapshot?.instances.find((instance) => instance.id === form.id)
    : undefined;

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
  );
};
