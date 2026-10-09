import React from 'react';
import { Box } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { MessageCircle } from 'lucide-react';
import { SelectDropdown, SettingRow } from '../components';
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

/** The model that answers a bot message naming none; a model command such as `/gemini` picks its own. */
export const BotDefaultModelSetting: React.FC<Props> = ({ value, busy, hint, onUpdate, t }) => {
  const hidden = useAppStore(useShallow(selectHiddenSources));
  const targetHidden = value.targetUrl !== '' && isModelUrlHidden(value.targetUrl, hidden);
  const { sections, allModels } = useProviderModels(targetHidden ? '' : value.targetUrl);
  const options = [
    { value: '', label: t('settings.bot.builtin.modelAppDefault') },
    ...providerSectionsToSelectData(sections),
  ];
  const known = !targetHidden
    && (value.targetUrl === '' || allModels.some((model) => model.url === value.targetUrl));

  return (
    <SettingRow
      icon={<MessageCircle size={13} />}
      label={t('settings.bot.defaultModel.label')}
      hint={hint}
      alignStart
      control={
        <Box w={220}>
          <SelectDropdown
            value={known ? value.targetUrl : ''}
            options={options}
            onChange={(v) => onUpdate({ targetUrl: v })}
            disabled={busy}
            maxDropdownHeight={PROVIDER_DROPDOWN_MAX_HEIGHT}
          />
        </Box>
      }
    />
  );
};
