import React from 'react';
import { Alert, Group, Stack, Text } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import type { NotionConflictView } from '../../../../shared/notion/notionSyncTypes';
import { AppButton } from '../../components/AppButton';
import { RenderedDiff } from '../../components/chat/RenderedDiff';

interface ConflictCardProps {
  conflict: NotionConflictView;
  /** A sync is running, or the editor is open (resolving rewrites the file under it). */
  disabled: boolean;
  onResolve: (key: string, choice: 'mine' | 'theirs') => void;
  /** Opens the paragraph editor on the user's side of this conflict, to merge by hand. */
  onEdit: (conflict: NotionConflictView) => void;
  t: (key: string) => string;
}

/**
 * A place both the user and Notion changed. Notion's text and the user's side by side, what only
 * one has marked; the user keeps one, or edits theirs (the card goes once the text no longer
 * matches either side, and the edit then waits in the preview like any other).
 */
export const ConflictCard: React.FC<ConflictCardProps> = ({ conflict, disabled, onResolve, onEdit, t }) => {
  const theirs = conflict.remote.join('\n');
  const mine = conflict.local.join('\n');

  return (
    <Alert
      color="var(--mantine-color-warning)"
      variant="light"
      icon={<TriangleAlert size={16} />}
      title={t('notion.conflict.title')}
      data-selection-ignore
      data-find-omit
    >
      <Text fz="var(--font-size-sm)" mb={8}>{t('notion.conflict.body')}</Text>
      {/* Both versions as they read; what only one of them has is marked on it. */}
      <Stack gap={4}>
        <RenderedDiff
          before={theirs}
          after={mine}
          beforeLabel={t('notion.conflict.theirs')}
          afterLabel={t('notion.conflict.mine')}
          srRemoved={t('notion.conflict.srTheirs')}
          srAdded={t('notion.conflict.srMine')}
        />
        {!theirs && <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('notion.conflict.theirsDeleted')}</Text>}
        {!mine && <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('notion.conflict.mineDeleted')}</Text>}
      </Stack>
      <Group gap={8} mt={10}>
        <AppButton size="compact-sm" variant="default" disabled={disabled} onClick={() => onResolve(conflict.key, 'theirs')}>
          {t('notion.conflict.useTheirs')}
        </AppButton>
        <AppButton size="compact-sm" variant="light" disabled={disabled} onClick={() => onResolve(conflict.key, 'mine')}>
          {t('notion.conflict.useMine')}
        </AppButton>
        {mine && (
          <AppButton size="compact-sm" variant="subtle" disabled={disabled} onClick={() => onEdit(conflict)}>
            {t('notion.conflict.edit')}
          </AppButton>
        )}
      </Group>
    </Alert>
  );
};
