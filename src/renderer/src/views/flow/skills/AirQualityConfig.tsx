import React, { useEffect, useState } from 'react';
import { Divider, Group, Stack, Text } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { DATA_KEY_MOENV } from '../../../../../shared/types';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { AppButton } from '../../../components/AppButton';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { dataKeyApi } from '../../../api/electronApi';
import { SecretHealthAlert } from '../../../components/SecretHealthAlert';
import { ExternalLink } from '../../settings/sections/lineLinks';
import type { SkillConfigProps } from './types';

const MOENV_REGISTER_URL = 'https://data.moenv.gov.tw/paradigm';

export const AirQualityConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const source = step.config.source ?? 'auto';
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshKey = async (): Promise<void> => {
    const status = await dataKeyApi.getStatus(DATA_KEY_MOENV);
    setHasKey(status.hasKey);
    setPreview(status.preview);
  };

  useEffect(() => { void refreshKey(); }, []);

  const handleSaveKey = async (): Promise<void> => {
    setBusy(true);
    await dataKeyApi.update(DATA_KEY_MOENV, key);
    setKey('');
    await refreshKey();
    setBusy(false);
  };

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
      <Text fz="xs" c="dimmed">{t('flow.skill.air_quality.location.hint')}</Text>
      <SelectDropdown
        label={t('flow.skill.air_quality.source')}
        options={[
          { value: 'auto', label: t('flow.skill.air_quality.source.auto') },
          { value: 'global', label: t('flow.skill.air_quality.source.global') },
          { value: 'taiwan', label: t('flow.skill.air_quality.source.taiwan') },
        ]}
        value={source}
        onChange={(value) => onChange({ ...step.config, source: value })}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t(`flow.skill.air_quality.source.${source}.hint`)}</Text>

      {source !== 'global' && (
        <>
          <Divider my={4} />
          <Text fz="sm" fw={600}>{t('flow.skill.air_quality.moenv')}</Text>
          <Text fz="xs" c="dimmed">{t('flow.skill.air_quality.moenv.hint')}</Text>
          <Group gap={8} align="flex-end">
            <AppPasswordInput
              flex={1}
              label={t('flow.skill.air_quality.moenv.key')}
              placeholder={t('flow.skill.air_quality.moenv.key.placeholder')}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              size="sm"
              tone="body"
            />
            <AppButton
              variant="default"
              leftSection={<KeyRound size={13} />}
              loading={busy}
              onClick={() => { void handleSaveKey(); }}
            >
              {t('flow.skill.air_quality.moenv.save')}
            </AppButton>
          </Group>
          <Group gap={6}>
            <Text fz="xs" c="dimmed">
              {t('flow.skill.air_quality.moenv.current')}:{' '}
              {hasKey ? (preview || '****') : t('flow.skill.air_quality.moenv.notSet')}
            </Text>
            <ExternalLink url={MOENV_REGISTER_URL} label={t('flow.skill.air_quality.moenv.register')} />
          </Group>
        </>
      )}

      <Text fz="xs" c="dimmed">{t('flow.skill.air_quality.disclosure')}</Text>
    </Stack>
  );
};
