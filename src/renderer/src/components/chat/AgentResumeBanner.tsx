import { Box, Group, Text } from '@mantine/core';
import { History, Play, Trash2 } from 'lucide-react';
import { AppButton } from '../AppButton';
import { useI18nStore } from '../../store/i18nStore';
import type { AgentRunSummary } from '../../../../shared/types';

interface AgentResumeBannerProps {
  runs: AgentRunSummary[];
  onResume: (runId: string, goal: string) => void;
  onDiscard: (runId: string) => void;
}

export function AgentResumeBanner({ runs, onResume, onDiscard }: AgentResumeBannerProps) {
  const t = useI18nStore((s) => s.t);
  const top = runs[0];
  if (!top) return null;
  const goalPreview = top.goal.length > 60 ? `${top.goal.slice(0, 60)}…` : top.goal;

  return (
    <Box style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <History size={15} />
          <Text size="sm" lineClamp={1}>
            {t('agent.banner.title')}: {goalPreview}
          </Text>
        </Group>
        <Group gap={6} wrap="nowrap">
          <AppButton size="xs" leftSection={<Play size={13} />} onClick={() => onResume(top.runId, top.goal)}>
            {t('agent.card.resume')}
          </AppButton>
          <AppButton size="xs" variant="subtle" leftSection={<Trash2 size={13} />} onClick={() => onDiscard(top.runId)}>
            {t('agent.card.discard')}
          </AppButton>
        </Group>
      </Group>
    </Box>
  );
}
