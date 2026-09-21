import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { MessagesSquare } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { formatTokenCount, meanTokens } from '../../../../../../shared/tokenEstimate';
import type { ConversationTokenStats } from '../../../../../../shared/tokenEstimate';
import { HelpDot, InlineStat } from './parts';

interface Props {
  stats: ConversationTokenStats | null;
  t: (key: string) => string;
}

/**
 * Read back from the saved conversation files rather than the counters, so it covers every
 * conversation on disk and deliberately ignores the date range above. Says so in its hint.
 */
export const ConversationCard: React.FC<Props> = ({ stats, t }) => {
  if (!stats || stats.conversations === 0) return null;
  const total = stats.input + stats.output;
  const mark = (value: number | null): string =>
    value === null ? '—' : `${stats.exact ? '' : '~'}${formatTokenCount(value)}`;

  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle icon={<MessagesSquare size={15} />} label={t('settings.stats.tokens.average')} mb={0} />
        <HelpDot hint={t('settings.stats.tokens.average.hint')} />
      </Group>
      <Stack gap={8}>
        <Group gap={20} wrap="wrap">
          <InlineStat
            label={t('settings.stats.tokens.average.perConversation')}
            value={mark(meanTokens(total, stats.conversations))}
          />
          <InlineStat
            label={t('settings.stats.tokens.average.perTurn')}
            value={mark(meanTokens(total, stats.turns))}
          />
          <InlineStat
            label={t('settings.stats.tokens.average.conversations')}
            value={stats.conversations.toLocaleString()}
          />
        </Group>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
          {t('settings.stats.tokens.average.scope')}
        </Text>
      </Stack>
    </SectionCard>
  );
};
