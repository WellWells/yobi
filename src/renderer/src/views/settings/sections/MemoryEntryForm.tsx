import React, { useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { Check, TriangleAlert } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import type { MemoryEditFailure } from '../../../../../shared/userMemory';

interface Props {
  initial: string;
  maxChars: number;
  busy: boolean;
  error: MemoryEditFailure | null;
  submitLabel: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  t: (key: string) => string;
}

export const MemoryEntryForm: React.FC<Props> = ({
  initial, maxChars, busy, error, submitLabel, placeholder, onSave, onCancel, t,
}) => {
  const [text, setText] = useState(initial);
  const length = text.trim().length;
  const tooLong = length > maxChars;
  const canSave = length > 0 && !tooLong && !busy && text.trim() !== initial.trim();

  const submit = (): void => {
    if (canSave) onSave(text);
  };

  return (
    <Stack gap={6} mt={6}>
      <AppTextarea
        value={text}
        autosize
        minRows={2}
        maxRows={5}
        autoFocus
        placeholder={placeholder}
        aria-label={submitLabel}
        error={tooLong}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          // Enter saves; Shift+Enter still breaks a line, and an IME composition keeps its own Enter.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {error && (
        <Group gap={6} wrap="nowrap" align="flex-start">
          <Box c="orange" mt={2} style={{ flexShrink: 0 }}><TriangleAlert size={13} /></Box>
          <Text fz="var(--font-size-sm)" c="orange">{t(`settings.memory.error.${error}`)}</Text>
        </Group>
      )}
      <Group justify="space-between" gap={8}>
        <Text fz="var(--font-size-sm)" c={tooLong ? 'var(--mantine-color-error)' : 'dimmed'}>
          {`${length} / ${maxChars}`}
        </Text>
        <Group gap={8}>
          <AppButton variant="default" size="xs" onClick={onCancel} disabled={busy}>
            {t('dialog.cancel')}
          </AppButton>
          <AppButton variant="filled" size="xs" leftSection={<Check size={13} />} loading={busy} disabled={!canSave} onClick={submit}>
            {submitLabel}
          </AppButton>
        </Group>
      </Group>
    </Stack>
  );
};
