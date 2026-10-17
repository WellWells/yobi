import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { useI18nStore } from '../store/i18nStore';
import type { AgentTraceTurn } from '../store/useAgentRunStore';
import { ResearchChecklist } from './ResearchChecklist';
import {
  NUMBERED_LABEL_OFFSET,
  PROGRESS_ROW_STYLE,
  ProgressMark,
  StepNumber,
  type ProgressState,
} from './ProgressMark';

const HIDDEN_CONFIG_KEYS = new Set(['provider']);

const SUBLINE_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export function subLines(turn: AgentTraceTurn, t: (key: string) => string): string[] {
  const lines: string[] = [];
  if (turn.thought) lines.push(turn.thought);
  if (turn.stage) {
    lines.push(t(`agent.stage.${turn.stage.label}`).replace('{{detail}}', turn.stage.detail ?? ''));
  }
  if (turn.preview) lines.push(t('agent.trace.result').replace('{{preview}}', turn.preview));
  return lines;
}

export function configText(config?: Record<string, string>): string {
  if (!config) return '';
  return Object.entries(config)
    .filter(([key, value]) => !HIDDEN_CONFIG_KEYS.has(key) && value)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ');
}

export function AgentTraceRow({ turn }: { turn: AgentTraceTurn }) {
  const t = useI18nStore((state) => state.t);
  const mark: ProgressState = turn.status === 'ok' ? 'done' : turn.status === 'error' ? 'failed' : 'active';
  const config = configText(turn.config);
  const lines = subLines(turn, t);
  const label = turn.tool
    ?? (turn.provider
      ? t('agent.trace.asking').replace('{{provider}}', turn.provider)
      : t('agent.trace.thinking'));

  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      <Box style={PROGRESS_ROW_STYLE}>
        <StepNumber value={turn.turn} />
        <ProgressMark state={mark} />
        <Text component="span" style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, flexShrink: 0 }}>
          {label}
        </Text>
        {config && (
          <Text component="span" style={{ ...SUBLINE_STYLE, fontFamily: 'var(--font-mono, monospace)' }}>
            {config}
          </Text>
        )}
      </Box>
      {lines.map((line) => (
        <Text key={line} component="span" pl={NUMBERED_LABEL_OFFSET} style={SUBLINE_STYLE}>{line}</Text>
      ))}
      {turn.research && (
        <Box pl={NUMBERED_LABEL_OFFSET} style={{ minWidth: 0 }}>
          <ResearchChecklist progress={turn.research} ended={turn.status === 'ok' || turn.status === 'error'} t={t} />
        </Box>
      )}
    </Stack>
  );
}

export const AgentTraceRows: React.FC<{ trace: AgentTraceTurn[] }> = ({ trace }) => (
  <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    {trace.map((turn) => (
      <AgentTraceRow key={turn.turn} turn={turn} />
    ))}
  </Box>
);
