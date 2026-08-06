import React from 'react';
import { Box, Stack } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { MessageCircle } from 'lucide-react';
import { SelectDropdown, SettingRow, ToggleSwitch } from '../components';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import { selectHiddenSources, useAppStore } from '../../../store/appStore';
import { isModelUrlHidden } from '../../../../../shared/types';
import type { BotLlmDirectConfig } from '../../../../../shared/types';

interface Props {
  value: BotLlmDirectConfig;
  busy: boolean;
  hint: string;
  onUpdate: (patch: Partial<BotLlmDirectConfig>) => void;
  t: (key: string) => string;
}

export const BotLlmDirectSetting: React.FC<Props> = ({ value, busy, hint, onUpdate, t }) => {
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const targetHidden = value.targetUrl !== '' && isModelUrlHidden(value.targetUrl, hidden);
  const { sections, allModels } = useProviderModels(targetHidden ? '' : value.targetUrl);
  const options = [
    { value: '', label: t('settings.llmDirect.appDefault') },
    ...providerSectionsToSelectData(sections),
  ];
  const known = !targetHidden
    && (value.targetUrl === '' || allModels.some((model) => model.url === value.targetUrl));

  return (
    <Stack gap={8}>
      <SettingRow
        icon={<MessageCircle size={13} />}
        label={t('settings.llmDirect.label')}
        hint={hint}
        alignStart
        control={
          <ToggleSwitch
            checked={value.enabled}
            disabled={busy}
            onChange={() => onUpdate({ enabled: !value.enabled })}
          />
        }
      />
      {value.enabled && (
        <Box maw={300}>
          <SelectDropdown
            value={known ? value.targetUrl : ''}
            options={options}
            onChange={(v) => onUpdate({ targetUrl: v })}
            disabled={busy}
            maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
          />
        </Box>
      )}
    </Stack>
  );
};
