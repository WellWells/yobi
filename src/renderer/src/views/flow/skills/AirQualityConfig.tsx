import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { DATA_KEY_MOENV } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { AppButton } from '../../../components/AppButton';
import { AppModal } from '../../../components/AppModal';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
import { dataKeyApi } from '../../../api/electronApi';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { Z_MODAL } from '../../../config/zLayers';
import { ExternalLink } from '../../settings/sections/lineLinks';
import type { SkillConfigProps } from './types';

const MOENV_REGISTER_URL = 'https://data.moenv.gov.tw/paradigm';

const SOURCES = ['auto', 'global', 'taiwan'] as const;
type Source = typeof SOURCES[number];

/** Any other value runs as `auto` (the executor's fallback), so it shows as that. */
export function airQualitySource(raw: string | undefined): Source {
  return SOURCES.find((source) => source === raw) ?? 'auto';
}

/**
 * Where the MOENV key is entered. The key is an app-wide setting (every air-quality step reads
 * it), so it is saved here at once and never into the flow; a dialog keeps that apart from the
 * step's own fields, and a failed save stays visible in it.
 */
const MoenvKeyDialog: React.FC<{
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  t: (key: string) => string;
}> = ({ opened, onClose, onSaved, t }) => {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = (): void => {
    setKey('');
    setFailed(false);
    onClose();
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await dataKeyApi.update(DATA_KEY_MOENV, key);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setKey('');
      onSaved();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      opened={opened}
      onClose={close}
      title={t('flow.skill.air_quality.moenv')}
      icon={<KeyRound size={16} />}
      zIndex={Z_MODAL}
    >
      <Stack gap="sm">
        <Text fz="xs" c="var(--text-muted)">{t('flow.skill.air_quality.moenv.hint')}</Text>
        <AppPasswordInput
          label={t('flow.skill.air_quality.moenv.key')}
          placeholder={t('flow.skill.air_quality.moenv.key.placeholder')}
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          size="sm"
          tone="body"
          data-autofocus
        />
        {failed && <StatusLine tone="error">{t('flow.skill.air_quality.moenv.saveFailed')}</StatusLine>}
        <Group justify="space-between" align="center">
          <ExternalLink url={MOENV_REGISTER_URL} label={t('flow.skill.air_quality.moenv.register')} />
          <Group gap="xs">
            <AppButton variant="default" size="xs" onClick={close}>{t('dialog.cancel')}</AppButton>
            <AppButton size="xs" loading={busy} onClick={() => { void save(); }}>
              {t('flow.skill.air_quality.moenv.save')}
            </AppButton>
          </Group>
        </Group>
      </Stack>
    </AppModal>
  );
};

export const AirQualityConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const source = airQualitySource(step.config.source);
  const [hasKey, setHasKey] = useState(false);
  const [preview, setPreview] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const refreshKey = async (): Promise<void> => {
    try {
      const status = await dataKeyApi.getStatus(DATA_KEY_MOENV);
      setHasKey(status.hasKey);
      setPreview(status.preview);
    } catch {
      setHasKey(false);
    }
  };

  useEffect(() => { void refreshKey(); }, []);

  const key = step.outputKey;

  return (
    <Stack gap="xs">
      <SecretHealthAlert scopes={['dataKey']} />
      <AppTextInput
        label={t('flow.skill.air_quality.location')}
        placeholder={t('flow.skill.air_quality.location.placeholder')}
        value={step.config.location ?? ''}
        onChange={(e) => onChange({ ...step.config, location: e.currentTarget.value })}
        size="sm"
      />
      <SelectDropdown
        label={t('flow.skill.air_quality.source')}
        options={SOURCES.map((value) => ({ value, label: t(`flow.skill.air_quality.source.${value}`) }))}
        value={source}
        onChange={(value) => onChange({ ...step.config, source: value })}
        size="sm"
      />
      <Text fz="xs" c="var(--text-muted)">{t(`flow.skill.air_quality.source.${source}.hint`)}</Text>

      {source !== 'global' && (
        <Group gap={8} wrap="nowrap" align="center">
          <Text fz="sm" style={{ flex: 1 }} c={hasKey ? undefined : 'var(--text-muted)'}>
            {hasKey
              ? fillTemplate(t('flow.skill.air_quality.moenv.status.set'), { key: preview || '****' })
              : t('flow.skill.air_quality.moenv.status.notSet')}
          </Text>
          <AppButton
            variant="default"
            size="compact-xs"
            leftSection={<KeyRound size={12} />}
            onClick={() => setDialogOpen(true)}
            style={{ flexShrink: 0 }}
          >
            {t('flow.skill.air_quality.moenv.open')}
          </AppButton>
        </Group>
      )}
      <MoenvKeyDialog opened={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={() => { void refreshKey(); }} t={t} />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.air_quality.outputHint'), { aqi: `{{${key}.aqi}}`, level: `{{${key}.level}}` })}
      </Text>
    </Stack>
  );
};
