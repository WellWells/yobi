import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Group, Loader, Stack, Text } from '@mantine/core';
import { CalendarX, Check, Merge, Pencil, RotateCcw, Scale, Shrink, Sparkles, TriangleAlert, Undo2 } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppModal } from '../../../components/AppModal';
import { AppTextarea } from '../../../components/AppTextarea';
import { ModelDropdown } from '../../../components/chat/ModelDropdown';
import { userMemoryApi } from '../../../api/electronApi';
import { Z_MODAL, Z_POPOVER } from '../../../config/zLayers';
import { NavItem } from '../components';
import { MemoryCurateCard, cardPickValid } from './MemoryCurateCard';
import type { CardPick } from './MemoryCurateCard';
import { MEMORY_CURATE_PRESETS } from '../../../../../shared/memoryCurate';
import type { MemoryCurateApplyResult, MemoryCurateDirection, MemoryCurateProposal } from '../../../../../shared/memoryCurate';
import type { UserMemorySnapshot } from '../../../../../shared/userMemory';

type Screen = 'start' | 'running' | 'review' | 'done' | 'failed';

const DIRECTION_ICON: Record<MemoryCurateDirection, React.ReactNode> = {
  all: <Sparkles size={14} />,
  merge: <Merge size={14} />,
  stale: <CalendarX size={14} />,
  rewrite: <Shrink size={14} />,
  conflict: <Scale size={14} />,
  custom: <Pencil size={14} />,
};

interface Props {
  open: boolean;
  /** The direction the tidy starts with — what the user asked for in a chat, or nothing. */
  focus: string;
  snapshot: UserMemorySnapshot;
  onClose: () => void;
  t: (key: string) => string;
  locale: string;
}

type Applied = Extract<MemoryCurateApplyResult, { ok: true }>;

function initialPicks(proposal: MemoryCurateProposal): Record<string, CardPick> {
  return Object.fromEntries(proposal.changes.map((change) => [
    change.key,
    { checked: change.sure, ...(change.text !== undefined ? { text: change.text } : {}) },
  ]));
}

/**
 * The model proposes, the user decides. Nothing reaches the memory until "apply", and then only
 * the ticked changes, each checked again against the memory as it is at that moment.
 */
export const MemoryCurateModal: React.FC<Props> = ({ open, focus, snapshot, onClose, t, locale }) => {
  const [screen, setScreen] = useState<Screen>('start');
  const [modelUrl, setModelUrl] = useState('');
  const [direction, setDirection] = useState<MemoryCurateDirection>('all');
  const [instruction, setInstruction] = useState('');
  const [feedback, setFeedback] = useState('');
  const [proposal, setProposal] = useState<MemoryCurateProposal | null>(null);
  const [picks, setPicks] = useState<Record<string, CardPick>>({});
  const [error, setError] = useState('');
  const [applied, setApplied] = useState<Applied | null>(null);
  const [undone, setUndone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // A result that arrives after the window was closed or a newer request started is dropped.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    setScreen('start');
    // A tidy asked for in a chat already carries its own words, so it starts on the custom row.
    setDirection(focus.trim() ? 'custom' : 'all');
    setInstruction(focus);
    setFeedback('');
    setProposal(null);
    setPicks({});
    setError('');
    setApplied(null);
    setUndone(null);
    let cancelled = false;
    void userMemoryApi.getCurateModel().then((url) => {
      if (!cancelled) setModelUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, focus]);

  const handleClose = useCallback(() => {
    requestSeq.current += 1;
    if (screen === 'running') void userMemoryApi.cancelCuration();
    onClose();
  }, [screen, onClose]);

  /** The chosen row as the model reads it: a preset's own words, or the user's. */
  const directive = useMemo(() => (direction === 'custom'
    ? instruction.trim()
    : MEMORY_CURATE_PRESETS.find((preset) => preset.key === direction)?.instruction ?? ''), [direction, instruction]);

  const run = useCallback(async (withFeedback: boolean) => {
    const seq = ++requestSeq.current;
    setScreen('running');
    const result = await userMemoryApi.proposeCuration({
      providerUrl: modelUrl,
      instruction: directive,
      ...(withFeedback ? { feedback } : {}),
    }).catch((err: unknown) => ({ ok: false as const, reason: 'failed' as const, error: err instanceof Error ? err.message : String(err) }));
    if (seq !== requestSeq.current) return;
    if (result.ok) {
      setProposal(result.proposal);
      setPicks(initialPicks(result.proposal));
      setFeedback('');
      setScreen('review');
      return;
    }
    if (result.reason === 'cancelled') {
      setScreen(proposal ? 'review' : 'start');
      return;
    }
    setError(result.reason === 'empty' ? t('settings.memory.empty') : result.error ?? '');
    setScreen('failed');
  }, [modelUrl, directive, feedback, proposal, t]);

  // A web page already writing its answer cannot be interrupted, so the window does not wait for
  // it: it goes back at once and drops whatever arrives later.
  const cancelRun = useCallback(() => {
    requestSeq.current += 1;
    void userMemoryApi.cancelCuration();
    setScreen(proposal ? 'review' : 'start');
  }, [proposal]);

  const changes = useMemo(() => proposal?.changes ?? [], [proposal]);
  const ticked = changes.filter((change) => picks[change.key]?.checked);
  const canApply = ticked.length > 0 && ticked.every((change) => cardPickValid(change, picks[change.key], snapshot.entryMaxChars));
  const usedAfter = ticked.reduce((sum, change) => {
    const removed = change.before.reduce((total, item) => total + item.text.length, 0);
    return sum - removed + (change.op === 'remove' ? 0 : (picks[change.key]?.text ?? '').trim().length);
  }, snapshot.usedChars);

  const apply = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const result = await userMemoryApi.applyCuration(proposal.id, ticked.map((change) => {
        const text = picks[change.key]?.text;
        return { key: change.key, ...(change.op !== 'remove' && text !== undefined && text !== change.text ? { text } : {}) };
      }));
      if (!result.ok) {
        setError(t('settings.memory.curate.expired'));
        setScreen('failed');
        return;
      }
      setApplied(result);
      setScreen('done');
    } finally {
      setBusy(false);
    }
  }, [proposal, ticked, picks, t]);

  const undo = useCallback(async () => {
    setBusy(true);
    try {
      setUndone((await userMemoryApi.undoCuration()).ok);
    } finally {
      setBusy(false);
    }
  }, []);

  const count = (key: string, value: number): string => t(key).replace('{{count}}', value.toLocaleString(locale));

  return (
    <AppModal
      opened={open}
      onClose={handleClose}
      title={t('settings.memory.curate.title')}
      icon={<Sparkles size={16} />}
      size="lg"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        {screen === 'start' && (
          <>
            <Stack gap={2}>
              {[...MEMORY_CURATE_PRESETS.map((preset) => preset.key), 'custom' as const].map((key) => (
                <NavItem
                  key={key}
                  active={direction === key}
                  hasMatch={false}
                  label={t(`settings.memory.curate.preset.${key}`)}
                  icon={DIRECTION_ICON[key]}
                  onClick={() => setDirection(key)}
                />
              ))}
            </Stack>
            {direction === 'custom' && (
              <AppTextarea
                value={instruction}
                onChange={(event) => setInstruction(event.currentTarget.value)}
                placeholder={t('settings.memory.curate.instruction.placeholder')}
                aria-label={t('settings.memory.curate.preset.custom')}
                autoFocus
                autosize
                minRows={2}
                maxRows={6}
              />
            )}
            <Group justify="space-between" align="center">
              <ModelDropdown value={modelUrl} onChange={setModelUrl} zIndex={Z_POPOVER} tooltipLabel={t('settings.memory.curate.model')} />
              <Group gap="xs">
                <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
                <AppButton
                  variant="filled"
                  size="xs"
                  leftSection={<Sparkles size={14} />}
                  disabled={!modelUrl || (direction === 'custom' && !instruction.trim())}
                  onClick={() => { void run(false); }}
                >
                  {t('settings.memory.curate.start')}
                </AppButton>
              </Group>
            </Group>
          </>
        )}

        {screen === 'running' && (
          <Group justify="space-between" align="center">
            <Group gap={8}>
              <Loader size="xs" />
              <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.memory.curate.running')}</Text>
            </Group>
            <AppButton variant="default" size="xs" onClick={cancelRun}>{t('dialog.cancel')}</AppButton>
          </Group>
        )}

        {screen === 'review' && (
          <>
            {changes.length === 0
              ? <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.memory.curate.nothing')}</Text>
              : (
                <Stack gap={6}>
                  <Group justify="space-between" gap={8}>
                    <Text fz="var(--font-size-sm)" c="dimmed">{count('settings.memory.curate.count', changes.length)}</Text>
                    <Text fz="var(--font-size-sm)" c="dimmed">
                      {t('settings.memory.curate.usage')
                        .replace('{{before}}', snapshot.usedChars.toLocaleString(locale))
                        .replace('{{after}}', Math.max(0, usedAfter).toLocaleString(locale))}
                    </Text>
                  </Group>
                  {changes.map((change) => (
                    <MemoryCurateCard
                      key={change.key}
                      change={change}
                      pick={picks[change.key] ?? { checked: false }}
                      maxChars={snapshot.entryMaxChars}
                      onChange={(pick) => setPicks((current) => ({ ...current, [change.key]: pick }))}
                      t={t}
                    />
                  ))}
                </Stack>
              )}
            <Stack gap={6}>
              <AppTextarea
                value={feedback}
                onChange={(event) => setFeedback(event.currentTarget.value)}
                placeholder={t('settings.memory.curate.feedback')}
                aria-label={t('settings.memory.curate.feedback')}
                autosize
                minRows={1}
                maxRows={4}
              />
              <Group justify="space-between" align="center">
                <AppButton variant="default" size="xs" leftSection={<RotateCcw size={13} />} disabled={!feedback.trim()} onClick={() => { void run(true); }}>
                  {t('settings.memory.curate.repropose')}
                </AppButton>
                <Group gap="xs">
                  <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
                  {changes.length > 0 && (
                    <AppButton variant="filled" size="xs" leftSection={<Check size={13} />} loading={busy} disabled={!canApply} onClick={() => { void apply(); }}>
                      {count('settings.memory.curate.apply', ticked.length)}
                    </AppButton>
                  )}
                </Group>
              </Group>
            </Stack>
          </>
        )}

        {screen === 'done' && applied && (
          <Stack gap={6}>
            <Text fz="var(--font-size-base)">
              {undone === true
                ? t('settings.memory.curate.undone')
                : applied.applied > 0 ? count('settings.memory.curate.done', applied.applied) : t('settings.memory.curate.none')}
            </Text>
            {undone === false && <Text fz="var(--font-size-sm)" c="orange">{t('settings.memory.curate.undoFailed')}</Text>}
            {applied.skipped > 0 && <Text fz="var(--font-size-sm)" c="orange">{count('settings.memory.curate.skipped', applied.skipped)}</Text>}
            {applied.failed > 0 && <Text fz="var(--font-size-sm)" c="orange">{count('settings.memory.curate.failedItems', applied.failed)}</Text>}
            <Group justify="flex-end" gap="xs" mt={4}>
              {applied.undoable && undone === null && (
                <AppButton variant="default" size="xs" leftSection={<Undo2 size={13} />} loading={busy} onClick={() => { void undo(); }}>
                  {t('settings.memory.curate.undo')}
                </AppButton>
              )}
              <AppButton variant="filled" size="xs" onClick={handleClose}>{t('settings.memory.curate.close')}</AppButton>
            </Group>
          </Stack>
        )}

        {screen === 'failed' && (
          <Stack gap="xs">
            <Alert color="red" icon={<TriangleAlert size={14} />} p="xs">
              <Stack gap={2}>
                <Text fz="xs" fw={600}>{t('settings.memory.curate.failed')}</Text>
                {error && <Text fz="xs" style={{ overflowWrap: 'anywhere' }}>{error}</Text>}
              </Stack>
            </Alert>
            <Group justify="flex-end" gap="xs">
              <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
              <AppButton variant="filled" size="xs" onClick={() => setScreen('start')}>{t('settings.memory.curate.retry')}</AppButton>
            </Group>
          </Stack>
        )}
      </Stack>
    </AppModal>
  );
};
