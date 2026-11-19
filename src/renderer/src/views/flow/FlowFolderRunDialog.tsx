import React, { useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Play } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { AppModal } from '../../components/AppModal';
import { GroupHeader } from '../../components/GroupHeader';
import { Z_MODAL } from '../../config/zLayers';
import { useSavedFlows } from '../../store/useSavedFlows';
import { useFlowStore } from '../../store/useFlowStore';
import { flowFolderApi } from '../../api/electronApi';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { planFlowBatch } from '../../../../shared/flowFolderRun';
import type { FlowFolder } from '../../../../shared/flowFolders';

interface FlowFolderRunDialogProps {
  /** The category asked to run; null = closed. */
  folder: FlowFolder | null;
  t: (key: string) => string;
  onClose: () => void;
}

/**
 * Before 「全部執行」: what will run, in what order, and what is left out and why — the flows
 * send messages and spend the user's quota, so a click on a category never starts them unseen.
 * Judged on the saved flows (what main runs) by the same `planFlowBatch` main uses.
 */
export const FlowFolderRunDialog: React.FC<FlowFolderRunDialogProps> = ({ folder, t, onClose }) => {
  const saved = useSavedFlows();
  const runningFlowIds = useFlowStore((s) => s.runningFlowIds);
  const [starting, setStarting] = useState(false);

  const { inside, plan } = useMemo(() => {
    const ids = new Set(folder?.flowIds ?? []);
    const flows = saved.filter((flow) => ids.has(flow.id));
    return { inside: new Map(flows.map((flow) => [flow.id, flow])), plan: planFlowBatch(flows, (id) => runningFlowIds.includes(id)) };
  }, [folder, saved, runningFlowIds]);

  const nameOf = (flowId: string): string => inside.get(flowId)?.name || t('flow.flowName');
  const count = plan.run.length;

  const start = async (): Promise<void> => {
    if (!folder || count === 0) return;
    setStarting(true);
    try {
      await flowFolderApi.run(folder.name);
    } finally {
      setStarting(false);
      onClose();
    }
  };

  return (
    <AppModal
      opened={folder !== null}
      onClose={onClose}
      title={fillTemplate(t('flow.folder.run.title'), { folder: folder?.name ?? '' })}
      icon={<Play size={16} />}
      size="md"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        {count > 0 ? (
          <>
            <Text fz="var(--font-size-sm)" c="var(--text-muted)">
              {fillTemplate(t('flow.folder.run.detail'), { count: String(count) })}
            </Text>
            {/* The order is the point: numbered in the text (a Mantine flex list drops the markers). */}
            <Stack gap={4}>
              {plan.run.map((flowId, index) => (
                <Group key={flowId} gap={8} wrap="nowrap">
                  <Text fz="var(--font-size-sm)" c="var(--text-muted)" w={22} ta="right" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {`${index + 1}.`}
                  </Text>
                  <Text fz="var(--font-size-sm)" truncate>{nameOf(flowId)}</Text>
                </Group>
              ))}
            </Stack>
          </>
        ) : (
          <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('flow.folder.run.none')}</Text>
        )}
        {plan.skipped.length > 0 && (
          <Stack gap={6}>
            <GroupHeader variant="plain" label={fillTemplate(t('flow.folder.run.skipped'), { count: String(plan.skipped.length) })} />
            {plan.skipped.map(({ flowId, reason }) => (
              <Group key={flowId} gap={6} wrap="nowrap">
                <Text fz="var(--font-size-sm)" c="var(--text-muted)" truncate>{nameOf(flowId)}</Text>
                <Text fz="xs" c="var(--text-muted)" style={{ flexShrink: 0 }}>{`· ${t(`flow.folder.run.reason.${reason}`)}`}</Text>
              </Group>
            ))}
          </Stack>
        )}
        <Group justify="flex-end" gap="xs">
          <AppButton variant="default" size="xs" onClick={onClose}>
            {t(count > 0 ? 'dialog.cancel' : 'flow.folder.run.close')}
          </AppButton>
          {count > 0 && (
            <AppButton variant="filled" size="xs" leftSection={<Play size={13} />} loading={starting} onClick={() => { void start(); }}>
              {fillTemplate(t('flow.folder.run.confirm'), { count: String(count) })}
            </AppButton>
          )}
        </Group>
      </Stack>
    </AppModal>
  );
};
