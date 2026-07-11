import React from 'react';
import { Box, Stack } from '@mantine/core';
import { MessageCircle } from 'lucide-react';
import { SelectDropdown, SettingRow, ToggleSwitch } from '../components';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, providerSectionsToSelectData } from '../../../config/models';
import { useProviderModels } from '../../../hooks/useProviderModels';
import type { BotLlmDirectConfig } from '../../../../../shared/types';

interface Props {
  value: BotLlmDirectConfig;
  busy: boolean;
  // Platform-specific explanation (Telegram adds the BotFather privacy note).
  hint: string;
  onUpdate: (patch: Partial<BotLlmDirectConfig>) => void;
  t: (key: string) => string;
}

// The command-free chat block shared by the Telegram and LINE sections: an
// enable switch plus the provider plain messages are handed to ('' = follow the
// app's default model).
export const BotLlmDirectSetting: React.FC<Props> = ({ value, busy, hint, onUpdate, t }) => {
  const { sections, allModels, hiddenSuffix } = useProviderModels(value.targetUrl);
  const options = [
    { value: '', label: t('settings.llmDirect.appDefault') },
    ...providerSectionsToSelectData(sections, hiddenSuffix),
  ];
  // A dangling target (a BYOK key deleted since) displays as the app default; the
  // stored value only changes when the user picks something. allModels is unfiltered,
  // so a merely hidden target still counts as known and stays selected.
  const known = value.targetUrl === '' || allModels.some((model) => model.url === value.targetUrl);

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
