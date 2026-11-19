import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowUp, Square } from 'lucide-react';
import { AppButton } from './AppButton';
import { AppTextarea } from './AppTextarea';
import { ModelDropdown } from './chat/ModelDropdown';
import { Z_POPOVER } from '../config/zLayers';
import { isComposingKey } from '../utils/imeKeys';

/** The interface scale shared by assistants beside documents and flows. */
export const ASSISTANT_TEXT = {
  body: 'var(--font-size-base)',
  secondary: 'var(--font-size-sm)',
  heading: 'var(--font-size-md)',
} as const;

interface AssistantSuggestionsProps {
  suggestions: readonly string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
}

export function AssistantSuggestions({ suggestions, onSelect, disabled }: AssistantSuggestionsProps): React.JSX.Element {
  return (
    <Stack gap={6} align="flex-start">
      {suggestions.map((text) => (
        <AppButton key={text} size="compact-xs" variant="default" disabled={disabled} onClick={() => onSelect(text)} style={{ maxWidth: '100%' }}>
          <Text fz={ASSISTANT_TEXT.secondary} truncate>{text}</Text>
        </AppButton>
      ))}
    </Stack>
  );
}

interface AssistantComposerProps {
  inputRef?: React.Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  modelUrl: string;
  onModelChange: (url: string) => void;
  placeholder: string;
  modelLabel: string;
  sendLabel: string;
  stopLabel: string;
  children?: React.ReactNode;
}

/** A full-width input with its model and send/stop controls on the row below. */
export function AssistantComposer({
  inputRef, value, onChange, onSend, onStop, running, modelUrl, onModelChange,
  placeholder, modelLabel, sendLabel, stopLabel, children,
}: AssistantComposerProps): React.JSX.Element {
  const canSend = !running && Boolean(value.trim()) && Boolean(modelUrl);
  return (
    <Box p={8} style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
      {children}
      <AppTextarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autosize
        minRows={2}
        maxRows={8}
        size="sm"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || isComposingKey(event.nativeEvent)) return;
          event.preventDefault();
          if (canSend) onSend();
        }}
      />
      <Group justify="space-between" gap={6} mt={6} wrap="nowrap">
        <Box style={{ minWidth: 0 }}>
          {modelUrl && <ModelDropdown value={modelUrl} onChange={onModelChange} menuDirection="up" zIndex={Z_POPOVER} tooltipLabel={modelLabel} />}
        </Box>
        {running ? (
          <Tooltip label={stopLabel} position="top">
            <ActionIcon size={28} variant="default" aria-label={stopLabel} onClick={onStop}>
              <Square size={12} />
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label={sendLabel} position="top">
            <ActionIcon size={28} variant="filled" aria-label={sendLabel} disabled={!canSend} onClick={onSend}>
              <ArrowUp size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Box>
  );
}
