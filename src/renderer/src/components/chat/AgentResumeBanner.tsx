import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { ChevronDown, Play, RotateCcwClock, Trash } from 'lucide-react';
import { AppButton } from '../AppButton';
import { CopyIconButton } from '../CopyIconButton';
import { ModelDropdown } from './ModelDropdown';
import { useI18nStore } from '../../store/i18nStore';
import type { AgentRunSummary } from '../../../../shared/types';

interface AgentResumeBannerProps {
  runs: AgentRunSummary[];
  onResume: (entry: AgentRunSummary, providerUrl?: string) => void;
  onDiscard: (runId: string) => void;
}

/** Continue the saved run, pick another model, or recover its original input. */
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
      <RotateCcwClock size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
      <Text size="sm" c="var(--text-muted)" style={{ flexShrink: 0 }}>
        {t('agent.banner.title')}
      </Text>
      <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>
        {top.goal.replace(/\s+/g, ' ').trim()}
      </Text>
      <AppButton size="xs" variant="light" leftSection={<Play size={12} />} onClick={() => onResume(top)} style={{ flexShrink: 0 }}>
        {t('agent.card.resume')}
      </AppButton>
      <ModelDropdown
        value={top.providerUrl}
        onChange={(url) => onResume(top, url)}
        renderTrigger={({ toggle, disabled }) => (
          <Tooltip label={t('agent.banner.resumeWithModel')}>
            <ActionIcon variant="subtle" color="gray" size="md" aria-label={t('agent.banner.resumeWithModel')} onClick={toggle} disabled={disabled} style={{ flexShrink: 0 }}>
              <ChevronDown size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      />
      <CopyIconButton key={top.runId} value={top.goal} copyLabel={t('agent.banner.copyInput')} copiedLabel={t('common.copied')} size="md" position="top" />
      <Tooltip label={discardLabel}>
        <ActionIcon variant="subtle" color="gray" size="md" aria-label={discardLabel} onClick={() => onDiscard(top.runId)} style={{ flexShrink: 0 }}>
          <Trash size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
