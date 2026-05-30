// Self-contained hotkey recorder for AgentFlow flows (no global settings side effects).
import React, { useCallback, useState } from 'react';
import { Box, Button, Group } from '@mantine/core';
import { X } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';

const IS_MAC = navigator.platform.toLowerCase().startsWith('mac');
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'OS'] as const;

function getKeyFromEvent(e: React.KeyboardEvent<HTMLInputElement>): string {
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (e.key === 'ArrowUp') return 'Up';
  if (e.key === 'ArrowDown') return 'Down';
  if (e.key === 'ArrowLeft') return 'Left';
  if (e.key === 'ArrowRight') return 'Right';
  if (e.key === 'Enter') return 'Return';
  if (e.key === ' ') return 'Space';
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

export interface HotkeyRecorderProps {
  value: string;
  onChange: (keys: string) => void;
  t: (k: string) => string;
}

export const HotkeyRecorder: React.FC<HotkeyRecorderProps> = ({ value, onChange, t }) => {
  const [recording, setRecording] = useState(false);
  const [liveDisplay, setLiveDisplay] = useState('');

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === 'Escape') {
      setRecording(false);
      setLiveDisplay('');
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push(IS_MAC ? 'Command' : 'Meta');

    if (!(MODIFIER_KEYS as readonly string[]).includes(e.key)) {
      const key = getKeyFromEvent(e);
      parts.push(key);
      if (parts.length > 1 || key.startsWith('F')) {
        const combo = parts.join('+');
        onChange(combo);
        setRecording(false);
        setLiveDisplay('');
        (e.currentTarget as HTMLInputElement).blur();
      } else {
        setLiveDisplay(parts.join('+'));
      }
    } else {
      setLiveDisplay(parts.join('+'));
    }
  }, [recording, onChange]);

  return (
    <Group gap={8} align="flex-end" wrap="nowrap">
      <Box flex={1}>
        <AppTextInput
          readOnly
          label={t('agentflow.trigger.keys')}
          tone={recording ? 'recording' : 'tertiary'}
          mono
          value={recording ? liveDisplay : value}
          onKeyDown={handleKeyDown}
          onFocus={() => { setRecording(true); setLiveDisplay(''); }}
          onBlur={() => { setRecording(false); setLiveDisplay(''); }}
          placeholder={recording ? t('settings.hotkey.recording') : t('agentflow.trigger.keys.placeholder')}
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
            setRecording(false);
            setLiveDisplay('');
          }}
        >
          {t('settings.hotkey.cancelRecording')}
        </Button>
      )}
    </Group>
  );
};
