import React, { useState } from 'react';
import { Box, Group, Loader, NavLink, ScrollArea, Stack, Text } from '@mantine/core';
import { History, Trash2 } from 'lucide-react';
import { AppButton } from '../AppButton';
import { AppModal } from '../AppModal';
import { WebDialog } from '../WebDialog';
import { Z_MODAL_CONFIRM } from '../../config/zLayers';

export interface VersionListItem {
  id: string;
  /** The save time, already formatted for the UI language. */
  time: string;
  /** Why or by whom this version was made. */
  label: string;
  /** A second short line under the label (a name, "same as now"). */
  detail?: string;
}

export interface VersionHistoryModalProps {
  opened: boolean;
  onClose: () => void;
  t: (key: string) => string;
  /** Shown above the list, under the title: what this history is of. */
  subject?: string;
  loading: boolean;
  items: VersionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Said in place of the list when there are no versions, or when this file cannot have any. */
  emptyText: string;
  /** Called after the user confirmed deleting every version. */
  onDeleteAll: () => void;
  /** The selected version: what it changed, and its actions. */
  children: React.ReactNode;
}

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * The version history of a conversation or a flow: the versions, newest first, on the left; the one
 * picked on the right. Deleting every version asks first — it cannot be undone.
 */
export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  opened, onClose, t, subject, loading, items, selectedId, onSelect, emptyText, onDeleteAll, children,
}) => {
  const [confirmAll, setConfirmAll] = useState(false);

  const body = (): React.ReactNode => {
    if (loading) {
      return (
        <Group justify="center" py={48}>
          <Loader size="sm" color="var(--mantine-color-accent)" />
        </Group>
      );
    }
    if (items.length === 0) {
      return (
        <Stack align="center" gap={10} py={40} px={24} ta="center">
          <History size={32} strokeWidth={1.5} color="var(--text-muted)" />
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)" maw={420} style={{ lineHeight: 1.6 }}>{emptyText}</Text>
        </Stack>
      );
    }
    return (
      <Group align="stretch" wrap="nowrap" gap="md" h="min(560px, 68vh)">
        <Stack w={230} gap={8} style={{ flexShrink: 0 }}>
          <ScrollArea flex={1} type="auto">
            <Stack gap={2} pr={6}>
              {items.map((item) => (
                <NavLink
                  key={item.id}
                  active={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                  label={<Text fz="var(--font-size-sm)" style={NUMERIC}>{item.time}</Text>}
                  description={item.detail ? `${item.label} · ${item.detail}` : item.label}
                  styles={{ root: { borderRadius: 'var(--mantine-radius-sm)' } }}
                />
              ))}
            </Stack>
          </ScrollArea>
          <AppButton
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<Trash2 size={14} />}
            onClick={() => setConfirmAll(true)}
          >
            {t('history.deleteAll')}
          </AppButton>
        </Stack>
        <Box flex={1} miw={0} style={{ display: 'flex', flexDirection: 'column' }}>
          {children}
        </Box>
      </Group>
    );
  };

  return (
    <>
      <AppModal opened={opened} onClose={onClose} title={t('history.title')} icon={<History size={18} />} size="72rem">
        {subject && (
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)" mb="sm" truncate>{subject}</Text>
        )}
        {body()}
      </AppModal>
      <WebDialog
        open={confirmAll}
        title={t('history.deleteAll.title')}
        description={t('history.deleteAll.body')}
        confirmText={t('history.deleteAll.confirm')}
        cancelText={t('dialog.cancel')}
        danger
        zIndex={Z_MODAL_CONFIRM}
        onConfirm={() => {
          setConfirmAll(false);
          onDeleteAll();
        }}
        onCancel={() => setConfirmAll(false)}
      />
    </>
  );
};
