import React, { useCallback, useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { FileText, Folder, MousePointerClick } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { AppNumberInput } from '../../components/AppNumberInput';
import { AppTextInput } from '../../components/AppTextInput';
import { AppTextarea } from '../../components/AppTextarea';
import { LineChatPicker } from '../../components/LineChatPicker';
import { ChatRecipientPicker } from '../../components/ChatRecipientPicker';
import { SelectDropdown } from '../../components/SelectDropdown';
import { systemApi, scraperApi } from '../../api/electronApi';
import { FeedUrlField } from './FeedUrlField';
import type { FlowVariable } from '../../../../shared/types';

export interface VariableFieldProps {
  variable: FlowVariable;
  onChange: (value: string) => void;
  t: (k: string) => string;
  asQuestion?: boolean;
  onBeforeNavigate?: () => void;
  allVariables?: FlowVariable[];
  onChangeMany?: (patch: Record<string, string>) => void;
}

function toBound(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const VariableField: React.FC<VariableFieldProps> = ({
  variable, onChange, t, asQuestion = false, onBeforeNavigate, allVariables, onChangeMany,
}) => {
  const label = asQuestion ? (variable.question?.trim() || variable.label) : variable.label;
  const isBlank = !variable.value.trim();
  const error = variable.required && isBlank ? t('flow.variables.required') : undefined;

  const pickPath = useCallback(async (mode: 'file' | 'folder') => {
    const picked = await systemApi.selectPath({ mode });
    if (picked?.path) onChange(picked.path);
  }, [onChange]);

  const [picking, setPicking] = useState(false);
  const [pickCount, setPickCount] = useState<number | null>(null);
  const pickUrl = variable.pickTarget
    ? (allVariables?.find((v) => v.key === variable.pickUrlKey)?.value ?? '').trim()
    : '';
  const canPick = pickUrl.length > 0 && !pickUrl.includes('{{');
  const writeKeys = variable.pickWriteKeys;
  const handlePick = useCallback(async () => {
    if (!variable.pickTarget || !canPick) return;
    setPicking(true);
    try {
      const res = await scraperApi.pickSelector({ url: pickUrl, target: variable.pickTarget });
      if (!res) return;
      setPickCount(res.count);
      if (variable.pickTarget !== 'list' || !onChangeMany) { onChange(res.selector); return; }
      const patch: Record<string, string> = { [variable.key]: res.itemSelector };
      if (writeKeys?.title) patch[writeKeys.title] = res.titleSelector;
      if (writeKeys?.link) patch[writeKeys.link] = res.linkSelector;
      onChangeMany(patch);
    } finally {
      setPicking(false);
    }
  }, [variable.pickTarget, variable.key, canPick, pickUrl, onChange, onChangeMany, writeKeys]);

  if (variable.type === 'chat') {
    return (
      <ChatRecipientPicker
        value={variable.value}
        onChange={onChange}
        label={label}
        hint={variable.hint}
        error={error}
        emptyHint={t('flow.skill.bot.chatId.noPaired')}
        onBeforeNavigate={onBeforeNavigate}
      />
    );
  }

  if (variable.type === 'lineChat') {
    return (
      <LineChatPicker
        value={variable.value}
        onChange={onChange}
        label={label}
        hint={variable.hint}
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
    const numeric = Number(variable.value);
    const isNumeric = variable.value.trim() !== '' && Number.isFinite(numeric);
    if (variable.value.trim() !== '' && !isNumeric) {
      return (
        <Stack gap={4}>
          <AppTextInput
            label={label}
            value={variable.value}
            onChange={(e) => onChange(e.currentTarget.value)}
            error={t('flow.variables.number.invalid')}
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
            {t('flow.variables.browse')}
          </Button>
        </Group>
      </Stack>
    );
  }

  if (variable.type === 'feed') {
    return (
      <FeedUrlField
        value={variable.value}
        onChange={onChange}
        label={label}
        placeholder={variable.placeholder}
        hint={variable.hint}
        error={error}
        t={t}
      />
    );
  }

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
  if (variable.pickTarget && allVariables) {
    return (
      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <AppTextInput
            label={label}
            placeholder={variable.placeholder}
            value={variable.value}
            onChange={(e) => { onChange(e.currentTarget.value); setPickCount(null); }}
            error={error}
            size="sm"
            tone="body"
            mono
            style={{ flex: 1 }}
          />
          <AppButton
            variant="default"
            size="sm"
            leftSection={<MousePointerClick size={14} />}
            loading={picking}
            disabled={!canPick}
            onClick={() => void handlePick()}
          >
            {t(variable.pickTarget === 'list' ? 'flow.skill.scraper.pickList' : 'flow.skill.scraper.pick')}
          </AppButton>
        </Group>
        {pickCount !== null && (
          <Text fz="xs" c="dimmed">
            {t('flow.skill.scraper.matchCount').replace('{{count}}', String(pickCount))}
          </Text>
        )}
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
