import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Group, ScrollArea, Stack, Text } from '@mantine/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { FlowChangeSummary, FlowVersionView } from '../../../../shared/flowVersions';
import { flowVersionNoneKey, isEmptyFlowChange } from '../../../../shared/flowVersions';
import { formatCardTime } from '../../../../shared/captureCard';
import { flowApi } from '../../api/electronApi';
import { AppButton } from '../../components/AppButton';
import { FlowEditRows } from '../../components/FlowEditRows';
import { GroupHeader } from '../../components/GroupHeader';
import { VersionHistoryModal } from '../../components/history/VersionHistoryModal';
import { WebDialog } from '../../components/WebDialog';
import { Z_MODAL_CONFIRM } from '../../config/zLayers';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import { useFlowStore } from '../../store/useFlowStore';

interface FlowVersionsDialogProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  flowName: string;
  /** The editor holds changes not saved yet; restoring replaces them, so it asks first. */
  dirty: boolean;
  t: (key: string) => string;
}

const Summary: React.FC<{ summary: FlowChangeSummary | null; t: (key: string) => string; none: string }> = ({ summary, t, none }) => {
  if (!summary || isEmptyFlowChange(summary)) return <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{none}</Text>;
  return <FlowEditRows edit={summary} t={t} maxHeight={220} />;
};

/**
 * The flow editor's ⋮ "Version history": every save that changed the flow, who made it, what it
 * changed, and what putting it back would change now.
 */
export const FlowVersionsDialog: React.FC<FlowVersionsDialogProps> = ({ open, onClose, flowId, flowName, dirty, t }) => {
  const locale = useI18nStore((s) => s.locale);
  const { replaceSavedFlow } = useFlowStore(useShallow((s) => ({ replaceSavedFlow: s.replaceSavedFlow })));
  const [versions, setVersions] = useState<FlowVersionView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const load = useCallback(async (keep: string | null) => {
    const result = await flowApi.listVersions(flowId).catch(() => ({ ok: false as const }));
    const list = result.ok ? result.versions : [];
    setVersions(list);
    setSelected((current) => {
      const wanted = keep ?? current;
      return list.some((entry) => entry.vid === wanted) ? wanted : list[0]?.vid ?? null;
    });
    if (!result.ok) showAppNotice({ level: 'error', message: t('history.loadFailed') });
  }, [flowId, t]);

  useEffect(() => {
    if (!open) return;
    setVersions(null);
    setSelected(null);
    void load(null);
  }, [open, load]);

  const items = useMemo(() => (versions ?? []).map((entry) => ({
    id: entry.vid,
    time: formatCardTime(entry.at, locale),
    label: t(`flow.versions.source.${entry.source}`),
    ...(entry.current ? { detail: t('flow.versions.current') } : {}),
  })), [versions, locale, t]);

  const version = versions?.find((entry) => entry.vid === selected) ?? null;

  const restore = async (): Promise<void> => {
    if (!version) return;
    setConfirmDiscard(false);
    setBusy(true);
    const result = await flowApi.restoreVersion(flowId, version.vid).catch(() => ({ ok: false as const, reason: 'failed' as const }));
    setBusy(false);
    if (!result.ok) {
      showAppNotice({ level: 'error', message: t(result.reason === 'missing' ? 'history.missing' : 'history.restoreFailed') });
      return;
    }
    replaceSavedFlow(result.flow);
    showAppNotice({ level: 'success', message: t(result.paused ? 'flow.versions.restoredPaused' : 'history.restored') });
    await load(null);
  };

  const deleteOne = async (): Promise<void> => {
    if (!version) return;
    if (!await flowApi.deleteVersion(flowId, version.vid).catch(() => false)) {
      showAppNotice({ level: 'error', message: t('history.deleteFailed') });
    }
    await load(null);
  };

  const deleteAll = async (): Promise<void> => {
    if (!await flowApi.clearVersions(flowId).catch(() => false)) {
      showAppNotice({ level: 'error', message: t('history.deleteFailed') });
    }
    await load(null);
  };

  return (
    <>
      <VersionHistoryModal
        opened={open}
        onClose={onClose}
        t={t}
        subject={flowName}
        loading={versions === null}
        items={items}
        selectedId={selected}
        onSelect={setSelected}
        emptyText={t('flow.versions.empty')}
        onDeleteAll={() => { void deleteAll(); }}
      >
        {version && (
          <Stack gap="sm" h="100%">
            <ScrollArea flex={1} type="auto">
              <Stack gap="md" pr={6}>
                <Stack gap={6}>
                  <GroupHeader variant="plain" label={t('flow.versions.thisSave')} />
                  {version.restoredFrom && (
                    <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('flow.versions.restoredFrom')}</Text>
                  )}
                  <Summary summary={version.summary} t={t} none={t(flowVersionNoneKey(version))} />
                </Stack>
                <Stack gap={6}>
                  <GroupHeader variant="plain" label={t('flow.versions.ifRestored')} />
                  <Summary summary={version.toCurrent} t={t} none={t('flow.versions.sameAsNow')} />
                </Stack>
              </Stack>
            </ScrollArea>
            <Group justify="flex-end" gap={8}>
              <AppButton variant="subtle" color="red" leftSection={<Trash2 size={14} />} onClick={() => { void deleteOne(); }}>
                {t('history.deleteOne')}
              </AppButton>
              <AppButton
                leftSection={<RotateCcw size={14} />}
                loading={busy}
                disabled={version.current || isEmptyFlowChange(version.toCurrent)}
                onClick={() => { if (dirty) setConfirmDiscard(true); else void restore(); }}
              >
                {version.current ? t('history.sameAsNow') : t('history.restore')}
              </AppButton>
            </Group>
          </Stack>
        )}
      </VersionHistoryModal>
      <WebDialog
        open={confirmDiscard}
        title={t('flow.versions.discard.title')}
        description={t('flow.versions.discard.body')}
        confirmText={t('flow.versions.discard.confirm')}
        cancelText={t('dialog.cancel')}
        danger
        zIndex={Z_MODAL_CONFIRM}
        onConfirm={() => { void restore(); }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
};
