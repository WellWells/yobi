import React from 'react';
import { Box, Button as MButton, Text } from '@mantine/core';
import { ListChecks, LoaderCircle, SkipForward, X } from 'lucide-react';
import type { QueueTaskItem } from '../../../../shared/types';
import styles from '../TitleBar.module.css';

export interface QueuePopoverProps {
  pos: { top: number; right: number };
  items: QueueTaskItem[];
  cancelingTaskIds: Record<string, boolean>;
  isForceSkipping: boolean;
  onCancelTask: (taskId: string) => Promise<void>;
  onForceSkip: () => Promise<void>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  t: (k: string) => string;
}

export const QueuePopover: React.FC<QueuePopoverProps> = ({
  pos, items, cancelingTaskIds, isForceSkipping, onCancelTask, onForceSkip, onMouseEnter, onMouseLeave, t,
}) => (
  <Box
    className={styles.popover}
    style={{ top: pos.top, right: pos.right }}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    onMouseDown={(event) => event.stopPropagation()}
  >
    <Box className={styles.popoverHeader}>
      <ListChecks size={16} style={{ flexShrink: 0 }} />
      <Text component="span">
        {t('queue.panel.title')}
      </Text>
    </Box>
    <Box className={styles.popoverBody}>
      {items.map((item) => {
        const isRunningItem = item.status === 'running';
        const isCanceling = Boolean(cancelingTaskIds[item.id]);
        return (
          <Box key={`${item.status}-${item.id}`} className={styles.queueItem}>
            <Box className={styles.queueItemTitleWrapper}>
              <Text className={styles.queueItemTitle}>{item.promptSummary}</Text>
              <Text className={styles.queueItemId}>#{item.id}</Text>
            </Box>
            <Box className={styles.queueItemRight}>
              <Box className={`${styles.queueItemStatusBadge} ${isRunningItem ? styles.running : styles.queued}`}>
                {isRunningItem ? t('queue.item.running') : t('queue.item.queued')}
              </Box>
              {isRunningItem ? (
                <MButton
                  onClick={() => { void onForceSkip(); }}
                  disabled={isForceSkipping}
                  variant="light"
                  size="xs"
                  color="orange"
                  leftSection={isForceSkipping ? <LoaderCircle size={12} /> : <SkipForward size={12} />}
                  styles={{ root: { height: 22, fontSize: 'var(--font-size-xs)', fontWeight: 600, padding: '0 8px' } }}
                >
                  {isForceSkipping ? t('queue.forceSkipping') : t('queue.forceSkip')}
                </MButton>
              ) : (
                <MButton
                  onClick={() => { void onCancelTask(item.id); }}
                  disabled={isCanceling}
                  variant="light"
                  size="xs"
                  color="red"
                  leftSection={isCanceling ? <LoaderCircle size={12} /> : <X size={12} />}
                  styles={{ root: { height: 22, fontSize: 'var(--font-size-xs)', fontWeight: 600, padding: '0 8px' } }}
                >
                  {isCanceling ? t('queue.canceling') : t('queue.cancel')}
                </MButton>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  </Box>
);
