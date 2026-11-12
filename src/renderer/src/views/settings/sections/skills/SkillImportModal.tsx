import React, { useEffect, useState } from 'react';
import { Badge, Box, Checkbox, Group, Stack, Text } from '@mantine/core';
import { Download } from 'lucide-react';
import { AppModal } from '../../../../components/AppModal';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput, StatusLine } from '../../components';
import { skillsApi } from '../../../../api/electronApi';
import { Z_MODAL } from '../../../../config/zLayers';
import { runtimeLabels, skillIssueText } from './skillText';
import { hasFatalIssue } from '../../../../../../shared/agentSkills';
import type { SkillImportCandidate, SkillImportResult, SkillInstallResult } from '../../../../../../shared/agentSkills';
import { fillTemplate } from '../../../../../../shared/fillTemplate';

/** How the dialog opens: asking for a link, or on what a picker (or the other agents' folders) found. */
export type SkillImportStart = { kind: 'url' } | { kind: 'result'; result: SkillImportResult };

interface Props {
  start: SkillImportStart | null;
  onClose: () => void;
  t: (key: string) => string;
}

const CandidateRow: React.FC<{
  candidate: SkillImportCandidate;
  checked: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}> = ({ candidate, checked, onToggle, t }) => {
  const fatal = hasFatalIssue(candidate.issues);
  const needs = runtimeLabels(candidate.needs);
  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap={10}
      p="8px 10px"
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
    >
      <Checkbox size="sm" mt={2} checked={checked} disabled={fatal} onChange={onToggle} aria-label={candidate.name} />
      <Stack gap={3} miw={0} flex={1}>
        <Group gap={6} wrap="wrap">
          <Text fz="var(--font-size-base)" fw={600} c="var(--text-primary)">{candidate.name}</Text>
          {candidate.origin && candidate.origin !== candidate.name && (
            <Text fz="var(--font-size-xs)" c="var(--text-muted)">{candidate.origin}</Text>
          )}
          {candidate.exists && <Badge variant="light" color="var(--mantine-color-warning)" size="sm">{t('settings.skills.import.replaces')}</Badge>}
        </Group>
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.5} lineClamp={3}>{candidate.description}</Text>
        <Text fz="var(--font-size-xs)" c="var(--text-muted)">
          {fillTemplate(t('settings.skills.files'), { count: String(candidate.files) })}
          {needs.length > 0 ? ` · ${fillTemplate(t('settings.skills.needs'), { programs: needs.join(', ') })}` : ''}
        </Text>
        {candidate.issues.map((issue) => (
          <StatusLine key={`${issue.code}:${issue.detail ?? ''}`} tone={hasFatalIssue([issue]) ? 'error' : 'warning'}>
            {skillIssueText(issue, t)}
          </StatusLine>
        ))}
      </Stack>
    </Group>
  );
};

/**
 * Import is a preview the user decides on: nothing reaches the skills folder until "Install",
 * and main checks every file again then. Closing without installing drops the preview's copy.
 */
export const SkillImportModal: React.FC<Props> = ({ start, onClose, t }) => {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<SkillImportResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<SkillInstallResult | null>(null);

  useEffect(() => {
    setUrl('');
    setInstalled(null);
    const opened = start?.kind === 'result' ? start.result : null;
    setResult(opened);
    setPicked(new Set(opened?.ok ? opened.preview.candidates.filter((c) => !hasFatalIssue(c.issues)).map((c) => c.key) : []));
  }, [start]);

  const preview = result?.ok ? result.preview : null;

  const close = (): void => {
    if (preview && !installed) void skillsApi.discard(preview.id);
    onClose();
  };

  const inspect = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await skillsApi.inspect({ kind: 'url', url: url.trim() });
      setResult(next);
      setPicked(new Set(next.ok ? next.preview.candidates.filter((c) => !hasFatalIssue(c.issues)).map((c) => c.key) : []));
    } finally {
      setBusy(false);
    }
  };

  const install = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    try {
      setInstalled(await skillsApi.install(preview.id, [...picked]));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string): void => setPicked((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const askingForLink = start?.kind === 'url' && !preview;

  return (
    <AppModal opened={start !== null} onClose={close} title={t('settings.skills.import.title')} icon={<Download size={16} />} size="lg" zIndex={Z_MODAL}>
      <Stack gap="md">
        {askingForLink && !installed && (
          <Stack gap={8}>
            <Text fz="var(--font-size-sm)" c="var(--text-primary)" lh={1.6}>{t('settings.skills.import.url.hint')}</Text>
            <AppTextInput
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              placeholder="https://github.com/anthropics/skills/tree/main/skills/pdf"
              onKeyDown={(event) => { if (event.key === 'Enter' && url.trim() && !busy) void inspect(); }}
              data-autofocus
            />
          </Stack>
        )}

        {result && !result.ok && (
          <StatusLine tone="error">{t(`settings.skills.import.fail.${result.reason}`)}</StatusLine>
        )}

        {preview && !installed && (
          <Stack gap={8}>
            <Text fz="var(--font-size-sm)" c="var(--text-primary)" lh={1.6}>
              {fillTemplate(t('settings.skills.import.found'), { count: String(preview.candidates.length), source: preview.source })}
            </Text>
            <Box mah={420} style={{ overflowY: 'auto' }}>
              <Stack gap={6}>
                {preview.candidates.map((candidate) => (
                  <CandidateRow key={candidate.key} candidate={candidate} checked={picked.has(candidate.key)} onToggle={() => toggle(candidate.key)} t={t} />
                ))}
              </Stack>
            </Box>
            <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.6}>{t('settings.skills.import.trust')}</Text>
          </Stack>
        )}

        {installed && (
          <Stack gap={6}>
            {installed.installed.length > 0 && (
              <StatusLine tone="success">
                {fillTemplate(t('settings.skills.import.done'), { names: installed.installed.join(', ') })}
              </StatusLine>
            )}
            {installed.failed.map((failure) => (
              <StatusLine key={failure.name} tone="error">{`${failure.name}: ${skillIssueText(failure.issue, t)}`}</StatusLine>
            ))}
          </Stack>
        )}

        <Group justify="flex-end" gap={8}>
          {installed ? (
            <AppButton onClick={close}>{t('settings.skills.import.close')}</AppButton>
          ) : (
            <>
              <AppButton variant="default" onClick={close}>{t('dialog.cancel')}</AppButton>
              {askingForLink ? (
                <AppButton loading={busy} disabled={!url.trim()} onClick={() => { void inspect(); }}>{t('settings.skills.import.next')}</AppButton>
              ) : preview ? (
                <AppButton loading={busy} disabled={picked.size === 0} onClick={() => { void install(); }}>
                  {fillTemplate(t('settings.skills.import.install'), { count: String(picked.size) })}
                </AppButton>
              ) : null}
            </>
          )}
        </Group>
      </Stack>
    </AppModal>
  );
};
