import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { History, Play, Trash2 } from 'lucide-react';
import { AppButton } from '../AppButton';
import { useI18nStore } from '../../store/i18nStore';
import type { AgentRunSummary } from '../../../../shared/types';

interface AgentResumeBannerProps {
  runs: AgentRunSummary[];
  onResume: (entry: AgentRunSummary) => void;
  onDiscard: (runId: string) => void;
}

/** One quiet row above the composer: a short label, the run's question, continue, discard. */
export function AgentResumeBanner({ runs, onResume, onDiscard }: AgentResumeBannerProps) {
  const t = useI18nStore((s) => s.t);
  const top = runs[0];
  if (!top) return null;
  const discardLabel = t('agent.card.discard');

  return (
    <Group
      gap={10}
      wrap="nowrap"
      py={6}
      pl={12}
      pr={6}
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10 }}
    >
      <History size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      <Text size="sm" c="var(--text-muted)" style={{ flexShrink: 0 }}>
        {t('agent.banner.title')}
      </Text>
      <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>
        {top.goal.replace(/\s+/g, ' ').trim()}
      </Text>
      <AppButton size="xs" variant="light" leftSection={<Play size={12} />} onClick={() => onResume(top)} style={{ flexShrink: 0 }}>
        {t('agent.card.resume')}
      </AppButton>
      <Tooltip label={discardLabel}>
        <ActionIcon variant="subtle" color="gray" size="md" aria-label={discardLabel} onClick={() => onDiscard(top.runId)} style={{ flexShrink: 0 }}>
          <Trash2 size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
