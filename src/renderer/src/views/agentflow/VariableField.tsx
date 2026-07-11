import React, { useCallback } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { FileText, Folder } from 'lucide-react';
import { AppNumberInput } from '../../components/AppNumberInput';
import { AppTextInput } from '../../components/AppTextInput';
import { AppTextarea } from '../../components/AppTextarea';
import { ChatRecipientPicker } from '../../components/ChatRecipientPicker';
import { SelectDropdown } from '../../components/SelectDropdown';
import { systemApi } from '../../api/electronApi';
import type { FlowVariable } from '../../../../shared/types';

// Renders one flow variable as the control its type deserves. The point is that
// a template's setup never shows a bare text box for something the app already
// knows — a chat recipient is a chip you click, a folder is a picker, a choice
// is a dropdown. Only `text` ends in someone typing prose.

export interface VariableFieldProps {
  variable: FlowVariable;
  onChange: (value: string) => void;
  t: (k: string) => string;
  /** Show the prompt text rather than the short label (setup wizard vs. settings panel). */
  asQuestion?: boolean;
  /** Passed to a chat field's picker so navigating to settings can close a host modal. */
  onBeforeNavigate?: () => void;
}

/** A blank or non-numeric min/max is no bound at all, not a bound of NaN. */
function toBound(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const VariableField: React.FC<VariableFieldProps> = ({
  variable, onChange, t, asQuestion = false, onBeforeNavigate,
}) => {
  const label = asQuestion ? (variable.question?.trim() || variable.label) : variable.label;
  const isBlank = !variable.value.trim();
  const error = variable.required && isBlank ? t('agentflow.variables.required') : undefined;

  const pickPath = useCallback(async (mode: 'file' | 'folder') => {
    const picked = await systemApi.selectPath({ mode });
    if (picked?.path) onChange(picked.path);
  }, [onChange]);

  if (variable.type === 'chat') {
    return (
      <ChatRecipientPicker
        value={variable.value}
        onChange={onChange}
        label={label}
        hint={variable.hint}
        error={error}
        emptyHint={t('agentflow.skill.bot.chatId.noPaired')}
        onBeforeNavigate={onBeforeNavigate}
      />
    );
  }

  if (variable.type === 'select') {
    return (
      <Stack gap={4}>
        <SelectDropdown
          label={label}
          options={(variable.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          value={variable.value}
          onChange={onChange}
          size="sm"
          error={error}
        />
        {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
      </Stack>
    );
  }

  if (variable.type === 'number') {
    // A variable's value is always a string, and it may not be a number at all
    // — the field's type can be switched after a value was typed, and an import
    // or a hand-edited flows.json can carry anything. Mantine's NumberInput
    // hands the raw string to NumericFormat, which strips the non-numeric
    // characters before displaying: "weekly" renders as an empty box and
    // "3days" renders as "3". Either way the box disagrees with the value that
    // will actually reach the step, and the box is the only thing the user sees.
    // So a non-numeric value is shown verbatim in a plain field, flagged, and
    // left for the user to correct rather than quietly misrepresented.
    const numeric = Number(variable.value);
    const isNumeric = variable.value.trim() !== '' && Number.isFinite(numeric);
    if (variable.value.trim() !== '' && !isNumeric) {
      return (
        <Stack gap={4}>
          <AppTextInput
            label={label}
            value={variable.value}
            onChange={(e) => onChange(e.currentTarget.value)}
            error={t('agentflow.variables.number.invalid')}
            size="sm"
            tone="body"
            mono
          />
          {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
        </Stack>
      );
    }
    return (
      <Stack gap={4}>
        <AppNumberInput
          label={label}
          value={isNumeric ? numeric : ''}
          onChange={(next) => onChange(next === '' ? '' : String(next))}
          min={toBound(variable.min)}
          max={toBound(variable.max)}
          size="sm"
          error={error}
        />
        {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
      </Stack>
    );
  }

  if (variable.type === 'folder' || variable.type === 'file') {
    const isFolder = variable.type === 'folder';
    return (
      <Stack gap={4}>
        <Text fz="sm" fw={500}>{label}</Text>
        {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <AppTextInput
            value={variable.value}
            onChange={(e) => onChange(e.currentTarget.value)}
            error={error}
            tone="body"
            mono
            style={{ flex: 1 }}
          />
          <Button
            variant="default"
            size="sm"
            leftSection={isFolder ? <Folder size={14} /> : <FileText size={14} />}
            onClick={() => { void pickPath(isFolder ? 'folder' : 'file'); }}
          >
            {t('agentflow.variables.browse')}
          </Button>
        </Group>
      </Stack>
    );
  }

  // text | url | feed — a plain field. `feed` will grow RSS auto-detection; until
  // then it behaves as a URL so a template declaring one still works today.
  if (variable.multiline) {
    return (
      <Stack gap={4}>
        <AppTextarea
          label={label}
          placeholder={variable.placeholder}
          value={variable.value}
          onChange={(e) => onChange(e.currentTarget.value)}
          error={error}
          size="sm"
          autosize
          minRows={2}
          maxRows={8}
          resize="vertical"
        />
        {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <AppTextInput
        label={label}
        placeholder={variable.placeholder}
        value={variable.value}
        onChange={(e) => onChange(e.currentTarget.value)}
        error={error}
        size="sm"
        tone={variable.type === 'text' ? undefined : 'body'}
        mono={variable.type !== 'text'}
      />
      {variable.hint && <Text fz="xs" c="dimmed">{variable.hint}</Text>}
    </Stack>
  );
};
