import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { MessageSquareDashed } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { tempChatApi } from '../../api/electronApi';
import { TEMP_CHAT_SHORTCUT_HINT } from '../../utils/keyLabels';

// Toggle for temporary chat mode. The mode itself lives in the main process
// (taskProcessor consults it); this only requests the change — the store is
// updated by the TEMP_CHAT_MODE_CHANGED broadcast, same as the keyboard path.
export const TempChatToggle: React.FC = () => {
  const tempChatMode = useAppStore((s) => s.tempChatMode);
  const { t } = useI18nStore();
  const label = `${t(tempChatMode ? 'chat.tempMode.disable' : 'chat.tempMode.enable')} (${TEMP_CHAT_SHORTCUT_HINT})`;

  return (
    <Tooltip label={label} position="bottom">
      <ActionIcon
        onClick={() => { void tempChatApi.setMode(!tempChatMode); }}
        aria-label={label}
        variant={tempChatMode ? 'light' : 'default'}
        size="md"
        radius="xl"
      >
        <MessageSquareDashed size={15} />
      </ActionIcon>
    </Tooltip>
  );
};
