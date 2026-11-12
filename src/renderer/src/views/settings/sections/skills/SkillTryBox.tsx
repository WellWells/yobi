import React, { useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { Play } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput, GroupHeader, StatusLine } from '../../components';
import { skillsApi } from '../../../../api/electronApi';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import type { SkillTextFiles, SkillTryResult } from '../../../../../../shared/skillAuthoring';
import { hasScripts } from './skillEditorModel';

type T = (key: string) => string;

interface Props {
  files: SkillTextFiles;
  /** The installed skill being edited: the draft stands in for it, its other files run with it. */
  name?: string;
  modelUrl: string;
  /** A draft is running: one model call at a time. */
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  t: T;
}

type Line = { tone: 'success' | 'warning' | 'error'; text: string };

/** What the try showed, as status lines: which skill the agent loaded, then which scripts it ran. */
export function tryLines(result: Extract<SkillTryResult, { ok: true }>, scripts: boolean, t: T): Line[] {
  const used = result.loaded.includes(result.draft);
  const others = result.loaded.filter((name) => name !== result.draft);
  const lines: Line[] = [];
  if (used) lines.push({ tone: 'success', text: t('settings.skills.try.used') });
  else if (others.length > 0) lines.push({ tone: 'warning', text: fillTemplate(t('settings.skills.try.other'), { name: others.join(', ') }) });
  else lines.push({ tone: 'warning', text: t('settings.skills.try.none') });
  if (!used || !scripts) return lines;
  const ran = result.scripts.filter((script) => script.skill === result.draft);
  if (ran.length === 0) lines.push({ tone: 'warning', text: t('settings.skills.try.noScript') });
  for (const script of ran) {
    lines.push({ tone: script.ok ? 'success' : 'error', text: fillTemplate(t(script.ok ? 'settings.skills.try.ran' : 'settings.skills.try.ranFailed'), { command: script.command }) });
  }
  return lines;
}

function failureText(result: Extract<SkillTryResult, { ok: false }>, t: T): string | null {
  if (result.reason === 'cancelled') return null;
  if (result.reason === 'onlyNamed') return t('settings.skills.try.onlyNamed');
  return result.error ?? t('settings.skills.ai.invalidOutput');
}

/**
 * "Try it": one request the user would really type, run by the agent on the chosen model with the
 * editor's files standing in for the skill (saved or not) beside the other installed skills, and
 * only tools that change nothing. Shown: whether it loaded this skill, which scripts it ran, and the
 * answer. One click is one run; nothing grades the answer with another call.
 */
export const SkillTryBox: React.FC<Props> = ({ files, name, modelUrl, disabled, onBusy, t }) => {
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SkillTryResult | null>(null);
  const canTry = Boolean(files['SKILL.md']?.trim() && request.trim() && modelUrl) && !busy && !disabled;

  const run = async (): Promise<void> => {
    setBusy(true);
    onBusy(true);
    setResult(null);
    try {
      setResult(await skillsApi.tryOut({ files, request, providerUrl: modelUrl, ...(name ? { name } : {}) }));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const failed = result && !result.ok ? failureText(result, t) : null;
  return (
    <Stack gap={8}>
      <GroupHeader variant="plain" label={t('settings.skills.try')} />
      <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.5}>{t('settings.skills.try.hint')}</Text>
      <Group gap={8} wrap="nowrap" align="center">
        <AppTextInput
          flex={1}
          value={request}
          onChange={(event) => { setRequest(event.currentTarget.value); setResult(null); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && canTry) void run(); }}
          placeholder={t('settings.skills.try.placeholder')}
          aria-label={t('settings.skills.try.placeholder')}
        />
        <AppButton size="xs" variant="default" loading={busy} disabled={!canTry} leftSection={<Play size={12} />} onClick={() => { void run(); }}>
          {t('settings.skills.try.run')}
        </AppButton>
      </Group>
      {failed && <StatusLine tone="error">{failed}</StatusLine>}
      {result?.ok && (
        <Stack gap={6}>
          {tryLines(result, hasScripts(files), t).map((line) => <StatusLine key={line.text} tone={line.tone}>{line.text}</StatusLine>)}
          <Box p="8px 10px" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}>
            <Text fz="var(--font-size-sm)" lh={1.6} lineClamp={12} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.answer}</Text>
          </Box>
        </Stack>
      )}
    </Stack>
  );
};
