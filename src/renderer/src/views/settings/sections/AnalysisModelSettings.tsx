import { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { Cpu } from 'lucide-react';
import { SectionCard, SectionTitle, SettingRow } from '../components';
import { FitSelectDropdown } from '../FitSelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import { useAppStore } from '../../../store/appStore';
import { settingsApi } from '../../../api/electronApi';
import type { useLinkAnalysisPreferences } from '../hooks/useLinkAnalysisPreferences';

type Preferences = ReturnType<typeof useLinkAnalysisPreferences>;

interface ModelSettingProps {
  value: string;
  label: string;
  hint: string;
  disabled: boolean;
  inheritLabel?: string;
  onChange: (value: string) => void;
}

function ModelSetting({ value, label, hint, disabled, inheritLabel, onChange }: ModelSettingProps) {
  const { sections, hiddenSuffix } = useProviderModels(value);
  const options = [
    ...(inheritLabel ? [{ value: '', label: inheritLabel }] : []),
    ...providerSectionsToSelectData(sections, hiddenSuffix),
  ];
  return (
    <SettingRow
      label={label}
      hint={hint}
      alignStart
      control={(
        <FitSelectDropdown
          value={value}
          options={options}
          onChange={onChange}
          disabled={disabled}
          aria-label={label}
          maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
        />
      )}
    />
  );
}

interface Props {
  analysis: Preferences;
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
}

export function AnalysisModelSettings({ analysis, t, visible, sectionGap }: Props) {
  const aiUrl = useAppStore((s) => s.aiUrl);
  const aiUrlLoaded = useAppStore((s) => s.aiUrlLoaded);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultFailed, setDefaultFailed] = useState(false);

  async function updateDefault(url: string): Promise<void> {
    setSavingDefault(true);
    setDefaultFailed(false);
    try {
      if (!await settingsApi.updateAiUrl(url)) {
        setDefaultFailed(true);
        return;
      }
      useAppStore.getState().setAiUrl(url);
    } catch {
      setDefaultFailed(true);
    } finally {
      setSavingDefault(false);
    }
  }

  return (
    <SectionCard style={{ marginBottom: sectionGap, display: visible ? 'block' : 'none' }}>
      <SectionTitle icon={<Cpu size={15} />} label={t('settings.modelDefaults.title')} />
      <Stack gap={14}>
        <ModelSetting
          value={aiUrl}
          label={t('settings.modelDefaults.default.label')}
          hint={t('settings.modelDefaults.default.hint')}
          disabled={!aiUrlLoaded || savingDefault}
          onChange={(value) => { void updateDefault(value); }}
        />
        <ModelSetting
          value={analysis.preferences.mapsTargetUrl}
          label={t('settings.modelDefaults.maps.label')}
          hint={t('settings.modelDefaults.maps.hint')}
          inheritLabel={t('settings.modelDefaults.followDefault')}
          disabled={!analysis.ready || analysis.busy}
          onChange={(value) => { void analysis.update({ mapsTargetUrl: value }); }}
        />
        <ModelSetting
          value={analysis.preferences.articleTargetUrl}
          label={t('settings.modelDefaults.article.label')}
          hint={t('settings.modelDefaults.article.hint')}
          inheritLabel={t('settings.modelDefaults.followDefault')}
          disabled={!analysis.ready || analysis.busy}
          onChange={(value) => { void analysis.update({ articleTargetUrl: value }); }}
        />
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.modelDefaults.inheritHint')}</Text>
        {(analysis.saveFailed || defaultFailed) && (
          <StatusLine tone="error">{t('settings.modelDefaults.saveFailed')}</StatusLine>
        )}
      </Stack>
    </SectionCard>
  );
}
