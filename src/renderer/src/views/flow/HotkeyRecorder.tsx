import React, { useState } from 'react';
import { Box, Button, Group } from '@mantine/core';
import { X } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { useComboRecorder } from '../../shortcuts/useComboRecorder';

export interface HotkeyRecorderProps {
  value: string;
  onChange: (keys: string) => void;
  t: (k: string) => string;
}

export const HotkeyRecorder: React.FC<HotkeyRecorderProps> = ({ value, onChange, t }) => {
  const [, setLiveDisplay] = useState('');

  const recorder = useComboRecorder({
    onCommit: onChange,
    onAbort: () => setLiveDisplay(''),
  });
  const { recording, draft, start, stop, handleKeyDown } = recorder;
  const liveDisplay = draft;

  return (
    <Group gap={8} align="flex-end" wrap="nowrap">
      <Box flex={1}>
        <AppTextInput
          readOnly
          label={t('flow.trigger.keys')}
          tone={recording ? 'recording' : 'tertiary'}
          mono
          value={recording ? liveDisplay : value}
          onKeyDown={handleKeyDown}
          onFocus={start}
          onBlur={stop}
          placeholder={recording ? t('settings.hotkey.recording') : t('flow.trigger.keys.placeholder')}
          size="sm"
          rightSection={recording ? (
            <Box
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--mantine-color-accent)',
                animation: 'pulse 1.2s ease-in-out infinite',
              }}
            />
          ) : undefined}
        />
      </Box>
      {recording && (
        <Button
          variant="light"
          size="sm"
          leftSection={<X size={13} />}
          onMouseDown={(e) => {
            e.preventDefault();
            stop();
          }}
        >
          {t('settings.hotkey.cancelRecording')}
        </Button>
      )}
    </Group>
  );
};
