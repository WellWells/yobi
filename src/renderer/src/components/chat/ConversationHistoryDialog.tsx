import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, ScrollArea, Stack, Text } from '@mantine/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import { stripConversationMarkers } from '../../../../shared/conversationDoc';
import { restoreBlockReason, sameConversationText } from '../../../../shared/conversationHistory';
import type { ConversationRestoreResult, ConversationVersionEntry } from '../../../../shared/conversationHistory';
import { formatCardTime } from '../../../../shared/captureCard';
import { conversationHistoryApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useAppStore } from '../../store/appStore';
import { useAnswerEditStore } from '../../store/answerEditStore';
import { useAgentRunStore } from '../../store/useAgentRunStore';
import { useI18nStore } from '../../store/i18nStore';
import { translateBusy, useTranslateStore } from '../../store/translateStore';
import { AppButton } from '../AppButton';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { TextDiffView } from '../history/TextDiffView';
import { VersionHistoryModal } from '../history/VersionHistoryModal';
import { showSavedContent } from './answerEditActions';

interface ConversationHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  content: string;
  conversation: ConversationDoc | null;
}

type Listing = { loading: true } | { loading: false; versions: ConversationVersionEntry[]; unversionable: boolean };

type RestoreFailure = Extract<ConversationRestoreResult, { ok: false }>['reason'];

const RESTORE_FAILURE_KEYS: Record<RestoreFailure, string> = {
  missing: 'history.missing',
  failed: 'history.restoreFailed',
  tooLarge: 'history.restoreTooLarge',
};

/**
 * ⋮ "Version history" of the open conversation: the versions kept before an edit in the App,
 * another app's change or a restore, each compared with the text as it is now.
 */
export const ConversationHistoryDialog: React.FC<ConversationHistoryDialogProps> = ({
  open, onClose, filePath, content, conversation,
}) => {
  const { t, locale } = useI18nStore(useShallow((s) => ({ t: s.t, locale: s.locale })));
  const [listing, setListing] = useState<Listing>({ loading: true });
  const [selected, setSelected] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [view, setView] = useState<'diff' | 'full'>('diff');
  const [busy, setBusy] = useState(false);

  const pending = useAppStore((s) => s.pendingTurns[filePath]?.length ?? 0);
  const draftOpen = useAnswerEditStore((s) => Object.keys(s.drafts).some((key) => key.endsWith(`\u0000${filePath}`)));
  const awaitingRun = useAgentRunStore((s) => s.pendingQuestion?.runId ?? null);
  const awaiting = Boolean(awaitingRun) && Boolean(conversation?.turns.some((turn) => turn.meta.r === awaitingRun));
  const translating = useTranslateStore((s) => Object.entries(s.jobs)
    .some(([key, job]) => key.startsWith(`${filePath}#`) && translateBusy(job)));
  const block = restoreBlockReason({ pending, awaiting, draftOpen, translating });

  const load = useCallback(async (keep?: string | null) => {
    const result = await conversationHistoryApi.list(filePath).catch(() => ({ status: 'failed' as const }));
    const versions = result.status === 'ok' ? result.versions : [];
    setListing({ loading: false, versions, unversionable: result.status === 'unversionable' });
    setSelected((current) => {
      const wanted = keep === undefined ? current : keep;
      return versions.some((entry) => entry.vid === wanted) ? wanted : versions[0]?.vid ?? null;
    });
    if (result.status === 'failed') showAppNotice({ level: 'error', message: t('history.loadFailed') });
  }, [filePath, t]);

  useEffect(() => {
    if (!open) return;
    setListing({ loading: true });
    setTexts({});
    setSelected(null);
    void load(null);
  }, [open, load]);

  useEffect(() => {
    if (!open || !selected || selected in texts) return;
    void conversationHistoryApi.get(filePath, selected).catch(() => null)
      .then((text) => setTexts((prev) => ({ ...prev, [selected]: text })));
  }, [open, selected, texts, filePath]);

  const versions = listing.loading ? [] : listing.versions;
  const items = useMemo(() => versions.map((entry) => ({
    id: entry.vid,
    time: formatCardTime(entry.at, locale),
    label: t(`history.reason.${entry.reason}`),
  })), [versions, locale, t]);

  const selectedText = selected ? texts[selected] : undefined;
  const sameAsNow = typeof selectedText === 'string' && sameConversationText(selectedText, content);

  const restore = async (): Promise<void> => {
    if (!selected || block) return;
    setBusy(true);
    const result = await conversationHistoryApi.restore(filePath, selected).catch(() => ({ ok: false as const, reason: 'failed' as const }));
    setBusy(false);
    if (!result.ok) {
      showAppNotice({ level: 'error', message: t(RESTORE_FAILURE_KEYS[result.reason]) });
      return;
    }
    // An undo of an earlier answer edit would now write over the restored text.
    if (useAnswerEditStore.getState().saved?.path === filePath) useAnswerEditStore.getState().setSaved(null);
    showSavedContent(filePath, result.content);
    showAppNotice({ level: 'success', message: t('history.restored') });
    await load();
  };

  const deleteOne = async (): Promise<void> => {
    if (!selected) return;
    const ok = await conversationHistoryApi.deleteVersion(filePath, selected).catch(() => false);
    if (!ok) showAppNotice({ level: 'error', message: t('history.deleteFailed') });
    await load(null);
  };

  const deleteAll = async (): Promise<void> => {
    const ok = await conversationHistoryApi.deleteAll(filePath).catch(() => false);
    if (!ok) showAppNotice({ level: 'error', message: t('history.deleteFailed') });
    await load(null);
  };

  const unversionable = !listing.loading && listing.unversionable;

  return (
    <VersionHistoryModal
      opened={open}
      onClose={onClose}
      t={t}
      loading={listing.loading}
      items={items}
      selectedId={selected}
      onSelect={setSelected}
      emptyText={t(unversionable ? 'history.unversionable' : 'history.empty')}
      onDeleteAll={() => { void deleteAll(); }}
    >
      <Stack gap="sm" h="100%">
        <Group justify="space-between" wrap="nowrap">
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)">
            {t(view === 'diff' ? 'history.diff.legend' : 'history.full.legend')}
          </Text>
          <AppSegmentedControl
            fullWidth={false}
            size="xs"
            value={view}
            onChange={(value) => setView(value === 'full' ? 'full' : 'diff')}
            options={[
              { value: 'diff', label: t('history.view.diff') },
              { value: 'full', label: t('history.view.full') },
            ]}
          />
        </Group>
        <ScrollArea flex={1} type="auto" style={{ border: '1px solid var(--border)', borderRadius: 'var(--mantine-radius-sm)' }}>
          <Stack p="sm" gap={0}>
            {selectedText === undefined && <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('main.loading')}</Text>}
            {selectedText === null && <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('history.missing')}</Text>}
            {typeof selectedText === 'string' && (view === 'diff'
              ? <TextDiffView before={stripConversationMarkers(selectedText)} after={stripConversationMarkers(content)} t={t} />
              : (
                <Text component="div" fz="var(--font-size-sm)" ff="var(--font-reading)" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>
                  {stripConversationMarkers(selectedText).trim()}
                </Text>
              ))}
          </Stack>
        </ScrollArea>
        {block && <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t(`history.blocked.${block}`)}</Text>}
        <Group justify="flex-end" gap={8}>
          <AppButton variant="subtle" color="red" leftSection={<Trash2 size={14} />} onClick={() => { void deleteOne(); }} disabled={!selected}>
            {t('history.deleteOne')}
          </AppButton>
          <AppButton
            leftSection={<RotateCcw size={14} />}
            loading={busy}
            disabled={!selected || Boolean(block) || typeof selectedText !== 'string' || sameAsNow}
            onClick={() => { void restore(); }}
          >
            {sameAsNow ? t('history.sameAsNow') : t('history.restore')}
          </AppButton>
        </Group>
      </Stack>
    </VersionHistoryModal>
  );
};
