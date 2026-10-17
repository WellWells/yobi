import { Box, Loader, Progress, Stack, Text } from '@mantine/core';
import { Check, Circle, X } from 'lucide-react';
import { researchFailed, researchFraction, researchPhase } from '../../../shared/researchProgress';
import type { ResearchPhase, ResearchProgress } from '../../../shared/researchProgress';
import { fillTemplate as fill } from '../../../shared/fillTemplate';

type Translate = (key: string) => string;

const LINE_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** What one phase says: its name, then its counts once it has any. */
export function phaseText(phase: ResearchPhase, t: Translate): string {
  const counted = phase.total !== undefined && phase.status !== 'pending';
  switch (phase.id) {
    case 'plan':
      return phase.queries?.length
        ? fill(t('agent.research.phase.planDone'), { queries: phase.queries.join('  ·  ') })
        : t('agent.research.phase.plan');
    case 'search':
      return phase.hits !== undefined
        ? fill(t('agent.research.phase.searchDone'), { hits: phase.hits })
        : t('agent.research.phase.search');
    case 'read': {
      const base = counted
        ? fill(t('agent.research.phase.readCount'), { done: phase.done ?? 0, total: phase.total ?? 0 })
        : t('agent.research.phase.read');
      return phase.failed
        ? `${base} · ${fill(t('agent.research.readFailed'), { count: phase.failed, hosts: (phase.failedHosts ?? []).join(', ') })}`
        : base;
    }
    case 'summarize': {
      const base = counted
        ? fill(t('agent.research.phase.summarizeCount'), { done: phase.done ?? 0, total: phase.total ?? 0 })
        : t('agent.research.phase.summarize');
      return phase.dropped ? `${base} · ${fill(t('agent.research.dropped'), { count: phase.dropped })}` : base;
    }
    case 'write':
      return t('agent.research.phase.write');
  }
}

/** The one line a finished research leaves behind. */
export function researchSummary(progress: ResearchProgress, t: Translate): string {
  const read = researchPhase(progress, 'read');
  const parts = [fill(t('agent.research.summary.read'), { count: read?.done ?? 0 })];
  if (read?.failed) parts[0] += fill(t('agent.research.summary.failed'), { count: read.failed });
  if (progress.sources !== undefined) parts.push(fill(t('agent.research.summary.sources'), { count: progress.sources }));
  return parts.join(' · ');
}

function PhaseIcon({ status }: { status: ResearchPhase['status'] }) {
  if (status === 'done') return <Check size={11} color="var(--mantine-color-success)" />;
  if (status === 'failed') return <X size={11} color="var(--mantine-color-error)" />;
  if (status === 'running') return <Loader size={10} />;
  return <Circle size={9} color="var(--mantine-color-dimmed)" />;
}

/**
 * A research call's progress under its trace row: every phase with its state while it runs, and a
 * bar that only moves on counts it really has. Once the call has ended well it shrinks to one line;
 * a failed one keeps the list, because where it stopped is the useful part.
 */
export function ResearchChecklist({ progress, ended, t }: { progress: ResearchProgress; ended: boolean; t: Translate }) {
  if (ended && !researchFailed(progress)) {
    return <Text component="span" style={LINE_STYLE}>{researchSummary(progress, t)}</Text>;
  }
  const fraction = researchFraction(progress);
  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      {progress.phases.map((phase) => (
        <Box key={phase.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Box component="span" style={{ flexShrink: 0, display: 'inline-flex', width: 11, justifyContent: 'center' }}>
            <PhaseIcon status={phase.status} />
          </Box>
          <Text component="span" style={LINE_STYLE}>{phaseText(phase, t)}</Text>
        </Box>
      ))}
      {!ended && (
        <Progress
          value={fraction.value}
          size={4}
          mt={4}
          maw={260}
          striped={fraction.indeterminate}
          animated={fraction.indeterminate}
          aria-label={t('agent.research.progress')}
        />
      )}
    </Stack>
  );
}
