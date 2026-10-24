import { Box, Group, Loader, Progress, Stack, Text } from '@mantine/core';
import { Download, Globe, Hourglass, Merge, Send } from 'lucide-react';
import type { StepProgress } from '../../../../shared/stepProgress';
import { stepProgressText } from '../../../../shared/stepProgress';

const PHASE_ICON = { working: Hourglass, reading: Globe, starting: Download, downloading: Download, processing: Merge, sending: Send } as const;

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * A flow step's progress while the chat waits for its answer: a live bar with the counts under
 * it. Without a percent (getting ready, merging, an unknown size) the bar runs striped instead of
 * pretending to know how far it is.
 */
export function StepProgressCard({ progress, t }: { progress: StepProgress; t: (key: string) => string }) {
  const { title, detail } = stepProgressText(progress, t);
  const Icon = PHASE_ICON[progress.phase];
  const known = progress.phase === 'downloading' && progress.percent !== null;

  return (
    <Box
      maw={460}
      px={14}
      py={12}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--bg-secondary)',
      }}
    >
      <Stack gap={8}>
        <Group gap={8} justify="space-between" wrap="nowrap">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Icon size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-md)" fw={500} truncate>{title}</Text>
          </Group>
          {known
            ? <Text fz="var(--font-size-md)" fw={600} style={NUMERIC}>{`${progress.percent}%`}</Text>
            : <Loader size={14} />}
        </Group>
        <Progress
          value={known ? progress.percent ?? 0 : 100}
          striped={!known}
          animated={!known}
          size={6}
          radius="xl"
          transitionDuration={200}
          aria-label={title}
        />
        {detail && <Text fz="var(--font-size-sm)" c="dimmed" style={NUMERIC}>{detail}</Text>}
      </Stack>
    </Box>
  );
}
