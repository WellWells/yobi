import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Box, Checkbox, Group, Loader, Stack, Text } from '@mantine/core';
import { Check, Folder, FolderPlus, RotateCcw, Sparkles, TriangleExclamationPoint, Undo2 } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { AppModal } from '../../components/AppModal';
import { AppTextarea } from '../../components/AppTextarea';
import { AppTextInput } from '../../components/AppTextInput';
import { ModelDropdown } from '../../components/chat/ModelDropdown';
import { flowFolderApi } from '../../api/electronApi';
import { Z_MODAL, Z_POPOVER } from '../../config/zLayers';
import { useFlowStore } from '../../store/useFlowStore';
import { FOLDER_NAME_MAX, folderNameProblem } from '../../../../shared/conversationFolders';
import { FLOW_SORT_NOTE_MAX_CHARS } from '../../../../shared/flowFolderSort';
import type { FlowSortApplyResult, FlowSortGroup, FlowSortProposal } from '../../../../shared/flowFolderSort';
import type { FlowDefinition } from '../../../../shared/types';
import { fillTemplate } from '../../../../shared/fillTemplate';

type Screen = 'start' | 'running' | 'review' | 'done' | 'failed';

interface GroupPick {
  /** The ticked flows of the group. */
  flowIds: string[];
  /** A new folder's name as the user may have edited it. */
  folder: string;
}

type Applied = Extract<FlowSortApplyResult, { ok: true }>;

interface Props {
  open: boolean;
  /** Every flow, for the names on the review screen. */
  flows: FlowDefinition[];
  /** Flows in no folder right now. */
  unfiledCount: number;
  onClose: () => void;
  t: (key: string) => string;
  locale: string;
}

function initialPicks(proposal: FlowSortProposal): Record<string, GroupPick> {
  return Object.fromEntries(proposal.groups.map((group) => [group.key, { flowIds: [...group.flowIds], folder: group.folder }]));
}

/**
 * Sorting the flows that are in no folder ("智慧分類"). The chosen model proposes folders; nothing
 * moves until "apply", and then only the ticked flows, each still unfiled at that moment.
 */
export const FlowFolderSortModal: React.FC<Props> = ({ open, flows, unfiledCount, onClose, t, locale }) => {
  const [screen, setScreen] = useState<Screen>('start');
  const [modelUrl, setModelUrl] = useState('');
  const [instruction, setInstruction] = useState('');
  const [feedback, setFeedback] = useState('');
  const [proposal, setProposal] = useState<FlowSortProposal | null>(null);
  const [picks, setPicks] = useState<Record<string, GroupPick>>({});
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
    setInstruction('');
    setFeedback('');
    setProposal(null);
    setPicks({});
    setError('');
    setApplied(null);
    setUndone(null);
    let cancelled = false;
    void flowFolderApi.getSortModel().then((url) => {
      if (!cancelled) setModelUrl(url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  const handleClose = useCallback(() => {
    requestSeq.current += 1;
    if (screen === 'running') void flowFolderApi.cancelSort();
    onClose();
  }, [screen, onClose]);

  const run = useCallback(async (withFeedback: boolean) => {
    const seq = ++requestSeq.current;
    setScreen('running');
    const result = await flowFolderApi.proposeSort({
      providerUrl: modelUrl,
      instruction,
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
    setError(result.reason === 'empty' ? t('flow.folder.sort.empty') : result.error ?? '');
    setScreen('failed');
  }, [modelUrl, instruction, feedback, proposal, t]);

  // A web page already writing its answer cannot be interrupted, so the window does not wait for
  // it: it goes back at once and drops whatever arrives later.
  const cancelRun = useCallback(() => {
    requestSeq.current += 1;
    void flowFolderApi.cancelSort();
    setScreen(proposal ? 'review' : 'start');
  }, [proposal]);

  const names = useMemo(() => new Map(flows.map((flow) => [flow.id, flow.name || t('flow.flowName')])), [flows, t]);
  const groups = useMemo(() => proposal?.groups ?? [], [proposal]);
  const nameProblem = (group: FlowSortGroup): string | null => {
    if (!group.isNew) return null;
    const problem = folderNameProblem(picks[group.key]?.folder ?? '', [], undefined, 'label');
    return problem ? t(`sidebar.folder.invalid.${problem}`) : null;
  };
  const tickedGroups = groups.filter((group) => (picks[group.key]?.flowIds.length ?? 0) > 0);
  const tickedCount = tickedGroups.reduce((sum, group) => sum + (picks[group.key]?.flowIds.length ?? 0), 0);
  const canApply = tickedCount > 0 && tickedGroups.every((group) => nameProblem(group) === null);

  const setGroup = (key: string, change: Partial<GroupPick>): void => {
    setPicks((current) => ({ ...current, [key]: { ...current[key]!, ...change } }));
  };
  const toggleFlow = (group: FlowSortGroup, flowId: string, checked: boolean): void => {
    const ticked = new Set(picks[group.key]?.flowIds ?? []);
    if (checked) ticked.add(flowId);
    else ticked.delete(flowId);
    setGroup(group.key, { flowIds: group.flowIds.filter((id) => ticked.has(id)) });
  };

  const apply = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    try {
      const result = await flowFolderApi.applySort(proposal.id, tickedGroups.map((group) => {
        const pick = picks[group.key]!;
        return { key: group.key, flowIds: pick.flowIds, ...(group.isNew && pick.folder !== group.folder ? { folder: pick.folder } : {}) };
      }));
      if (!result.ok) {
        setError(t('flow.folder.sort.expired'));
        setScreen('failed');
        return;
      }
      if (result.flows) useFlowStore.getState().adoptSavedOrder(result.flows);
      setApplied(result);
      setScreen('done');
    } finally {
      setBusy(false);
    }
  }, [proposal, tickedGroups, picks, t]);

  const undo = useCallback(async () => {
    setBusy(true);
    try {
      const result = await flowFolderApi.undoSort();
      if (result.flows) useFlowStore.getState().adoptSavedOrder(result.flows);
      setUndone(result.ok);
    } finally {
      setBusy(false);
    }
  }, []);

  const count = (key: string, value: number, extra: Record<string, string> = {}): string =>
    fillTemplate(t(key), { count: value.toLocaleString(locale), ...extra });

  return (
    <AppModal
      opened={open}
      onClose={handleClose}
      title={t('flow.folder.sort.title')}
      icon={<Sparkles size={16} />}
      size="lg"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        {screen === 'start' && (
          <>
            <Text fz="var(--font-size-sm)" c="var(--text-muted)">{count('flow.folder.sort.intro', unfiledCount)}</Text>
            <AppTextarea
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value.slice(0, FLOW_SORT_NOTE_MAX_CHARS))}
              placeholder={t('flow.folder.sort.instruction.placeholder')}
              aria-label={t('flow.folder.sort.instruction.label')}
              autosize
              minRows={2}
              maxRows={6}
            />
            <Group justify="space-between" align="center">
              <ModelDropdown value={modelUrl} onChange={setModelUrl} zIndex={Z_POPOVER} tooltipLabel={t('flow.folder.sort.model')} />
              <Group gap="xs">
                <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
                <AppButton
                  variant="filled"
                  size="xs"
                  leftSection={<Sparkles size={14} />}
                  disabled={!modelUrl || unfiledCount === 0}
                  onClick={() => { void run(false); }}
                >
                  {t('flow.folder.sort.start')}
                </AppButton>
              </Group>
            </Group>
          </>
        )}

        {screen === 'running' && (
          <Group justify="space-between" align="center">
            <Group gap={8}>
              <Loader size="xs" />
              <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('flow.folder.sort.running')}</Text>
            </Group>
            <AppButton variant="default" size="xs" onClick={cancelRun}>{t('dialog.cancel')}</AppButton>
          </Group>
        )}

        {screen === 'review' && proposal && (
          <>
            {groups.length === 0
              ? <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('flow.folder.sort.nothing')}</Text>
              : (
                <Stack gap={6}>
                  {groups.map((group) => {
                    const pick = picks[group.key] ?? { flowIds: [], folder: group.folder };
                    const all = pick.flowIds.length === group.flowIds.length;
                    const problem = pick.flowIds.length > 0 ? nameProblem(group) : null;
                    return (
                      <Box
                        key={group.key}
                        p="8px 10px"
                        bg="var(--mantine-color-bg-tertiary)"
                        style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
                      >
                        <Stack gap={6}>
                          <Group gap={10} wrap="nowrap" align="center">
                            <Checkbox
                              size="xs"
                              checked={pick.flowIds.length > 0}
                              indeterminate={pick.flowIds.length > 0 && !all}
                              aria-label={pick.folder}
                              onChange={(event) => setGroup(group.key, { flowIds: event.currentTarget.checked ? [...group.flowIds] : [] })}
                            />
                            {group.isNew ? <FolderPlus size={14} /> : <Folder size={14} />}
                            {group.isNew
                              ? (
                                <AppTextInput
                                  size="xs"
                                  value={pick.folder}
                                  maxLength={FOLDER_NAME_MAX}
                                  aria-label={t('flow.folder.sort.folderName')}
                                  error={problem ?? undefined}
                                  onChange={(event) => setGroup(group.key, { folder: event.currentTarget.value })}
                                  style={{ flex: 1, minWidth: 0 }}
                                />
                              )
                              : <Text fz="var(--font-size-sm)" fw={600} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{group.folder}</Text>}
                            {group.isNew && <Badge size="xs" variant="light">{t('flow.folder.sort.newFolder')}</Badge>}
                          </Group>
                          {group.why && <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ overflowWrap: 'anywhere' }}>{group.why}</Text>}
                          <Stack gap={4} pl={24}>
                            {group.flowIds.map((flowId) => (
                              <Checkbox
                                key={flowId}
                                size="xs"
                                checked={pick.flowIds.includes(flowId)}
                                label={names.get(flowId) ?? flowId}
                                onChange={(event) => toggleFlow(group, flowId, event.currentTarget.checked)}
                              />
                            ))}
                          </Stack>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            {proposal.leftOver.length > 0 && (
              <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ overflowWrap: 'anywhere' }}>
                {count('flow.folder.sort.leftOver', proposal.leftOver.length, {
                  names: proposal.leftOver.map((id) => names.get(id) ?? id).join(t('flow.folder.sort.nameSeparator')),
                })}
              </Text>
            )}
            {proposal.notSent > 0 && (
              <Text fz="var(--font-size-sm)" c="var(--text-muted)">{count('flow.folder.sort.notSent', proposal.notSent)}</Text>
            )}
            <Stack gap={6}>
              <AppTextarea
                value={feedback}
                onChange={(event) => setFeedback(event.currentTarget.value.slice(0, FLOW_SORT_NOTE_MAX_CHARS))}
                placeholder={t('flow.folder.sort.feedback')}
                aria-label={t('flow.folder.sort.feedback')}
                autosize
                minRows={1}
                maxRows={4}
              />
              <Group justify="space-between" align="center">
                <AppButton variant="default" size="xs" leftSection={<RotateCcw size={13} />} disabled={!feedback.trim()} onClick={() => { void run(true); }}>
                  {t('flow.folder.sort.repropose')}
                </AppButton>
                <Group gap="xs">
                  <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
                  {groups.length > 0 && (
                    <AppButton variant="filled" size="xs" leftSection={<Check size={13} />} loading={busy} disabled={!canApply} onClick={() => { void apply(); }}>
                      {count('flow.folder.sort.apply', tickedCount)}
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
                ? t('flow.folder.sort.undone')
                : applied.moved > 0
                  ? count('flow.folder.sort.done', applied.moved, { folders: applied.folders.toLocaleString(locale) })
                  : t('flow.folder.sort.none')}
            </Text>
            {undone === false && <Text fz="var(--font-size-sm)" c="var(--mantine-color-warning)">{t('flow.folder.sort.undoFailed')}</Text>}
            {applied.skipped > 0 && <Text fz="var(--font-size-sm)" c="var(--mantine-color-warning)">{count('flow.folder.sort.skipped', applied.skipped)}</Text>}
            {applied.failed > 0 && <Text fz="var(--font-size-sm)" c="var(--mantine-color-warning)">{count('flow.folder.sort.failedItems', applied.failed)}</Text>}
            <Group justify="flex-end" gap="xs" mt={4}>
              {applied.undoable && undone === null && (
                <AppButton variant="default" size="xs" leftSection={<Undo2 size={13} />} loading={busy} onClick={() => { void undo(); }}>
                  {t('flow.folder.sort.undo')}
                </AppButton>
              )}
              <AppButton variant="filled" size="xs" onClick={handleClose}>{t('flow.folder.sort.close')}</AppButton>
            </Group>
          </Stack>
        )}

        {screen === 'failed' && (
          <Stack gap="xs">
            <Alert color="var(--mantine-color-error)" icon={<TriangleExclamationPoint size={14} />} p="xs">
              <Stack gap={2}>
                <Text fz="xs" fw={600}>{t('flow.folder.sort.failed')}</Text>
                {error && <Text fz="xs" style={{ overflowWrap: 'anywhere' }}>{error}</Text>}
              </Stack>
            </Alert>
            <Group justify="flex-end" gap="xs">
              <AppButton variant="default" size="xs" onClick={handleClose}>{t('dialog.cancel')}</AppButton>
              <AppButton variant="filled" size="xs" onClick={() => setScreen('start')}>{t('flow.folder.sort.retry')}</AppButton>
            </Group>
          </Stack>
        )}
      </Stack>
    </AppModal>
  );
};
