import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip, Button as MButton } from '@mantine/core';
import { RotateCcw, X } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import type { HotkeyBindResult } from '../../../shared/types';

interface HotkeyFieldProps {
  recorder: {
    currentHotkey: string;
    hotkeyInput: string;
    recording: boolean;
    status: HotkeyBindResult;
    defaultValue: string;
    setRecording: (recording: boolean) => void;
    setHotkeyInput: (value: string) => void;
    handleHotkeyKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    handleClearHotkey: () => Promise<void>;
  };
  t: (key: string) => string;
  label: string;
  disabled?: boolean;
}

export const HotkeyField: React.FC<HotkeyFieldProps> = ({ recorder, t, label, disabled }) => {
  /*
   * The combination is named in the reset tooltip rather than the placeholder: the field
   * always carries a value, so its placeholder only ever shows mid-recording — the one
   * moment the default is not what the reader is asking about.
   */
  const resetLabel = t('settings.hotkey.resetDefaultTo').replace('{{hotkey}}', recorder.defaultValue);

  return (
    <Stack gap={6}>
      <Group gap={8} align="center">
        <Box flex={1} pos="relative">
          <AppTextInput
            readOnly
            disabled={disabled}
            aria-label={label}
            value={recorder.recording ? '' : recorder.hotkeyInput}
            tone={recorder.recording ? 'recording' : 'tertiary'}
            mono
            onKeyDown={recorder.handleHotkeyKeyDown}
            onFocus={() => recorder.setRecording(true)}
            onBlur={() => recorder.setRecording(false)}
            placeholder={recorder.recording
              ? t('settings.hotkey.recording')
              : t('settings.hotkey.placeholder')}
            rightSection={recorder.recording ? (
              <Box
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--mantine-color-accent)',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }}
              />
            ) : undefined}
          />
        </Box>
        {recorder.recording ? (
          <MButton
            variant="light"
            size="sm"
            leftSection={<X size={13} />}
            onMouseDown={(e) => {
              e.preventDefault();
              recorder.setRecording(false);
              recorder.setHotkeyInput(recorder.currentHotkey);
            }}
          >
            {t('settings.hotkey.cancelRecording')}
          </MButton>
        ) : (
          <Tooltip label={resetLabel} position="top">
            <ActionIcon
              variant="default"
              size={32}
              disabled={disabled}
              onClick={() => { void recorder.handleClearHotkey(); }}
              aria-label={resetLabel}
            >
              <RotateCcw size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {/* Registration is the only proof a binding works; silence used to be the whole report. */}
      {recorder.status === 'conflict' && (
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)" lh={1.5}>
          {t('settings.hotkey.conflict')}
        </Text>
      )}
      {recorder.status === 'taken' && (
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-warning)" lh={1.5}>
          {t('settings.hotkey.taken')}
        </Text>
      )}
    </Stack>
  );
};
