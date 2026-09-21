import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Coins } from 'lucide-react';
import { SectionCard, SectionTitle } from '../../components';
import { TrendBarChart } from '../../../../components/TrendBarChart';
import { formatTokenCount } from '../../../../../../shared/tokenEstimate';
import { Figure, HelpDot, LegendItem } from './parts';
import type { StatsAggregate } from './aggregate';
import { TOKEN_COLORS } from './colors';

interface Props {
  stats: StatsAggregate;
  t: (key: string) => string;
}

export const TokensCard: React.FC<Props> = ({ stats, t }) => {
  const total = stats.tokens.input + stats.tokens.output;
  // Days recorded before tokens were split by domain only carry a day total, so a scoped view
  // of that history is legitimately empty. Same rule as the other cards: nothing to say, no card.
  if (total === 0) return null;
  return (
    <SectionCard>
      <Group gap={7} align="center" mb={10} wrap="nowrap">
        <SectionTitle icon={<Coins size={15} />} label={t('settings.stats.tokens')} mb={0} />
        <HelpDot hint={t('settings.stats.tokens.hint')} />
      </Group>
      <Stack gap={16}>
        <Figure
          value={formatTokenCount(total)}
          caption={
            <Text component="span" fz="var(--font-size-sm)" c="dimmed">
              {t('settings.stats.tokens.caption')}
            </Text>
          }
        />
        <TrendBarChart
          labels={stats.labels}
          height={148}
          totalLabel={t('settings.stats.tokens.total')}
          formatValue={formatTokenCount}
          series={[
            {
              id: 'input',
              label: t('settings.stats.tokens.input'),
              color: TOKEN_COLORS.input,
              values: stats.tokensByDay.input,
            },
            {
              id: 'output',
              label: t('settings.stats.tokens.output'),
              color: TOKEN_COLORS.output,
              values: stats.tokensByDay.output,
            },
          ]}
        />
        <Group gap={2} wrap="wrap">
          <LegendItem
            color={TOKEN_COLORS.input}
            label={t('settings.stats.tokens.input')}
            value={stats.tokens.input.toLocaleString()}
            hint={t('settings.stats.tokens.input.hint')}
          />
          <LegendItem
            color={TOKEN_COLORS.output}
            label={t('settings.stats.tokens.output')}
            value={stats.tokens.output.toLocaleString()}
            hint={t('settings.stats.tokens.output.hint')}
          />
        </Group>
      </Stack>
    </SectionCard>
  );
};
