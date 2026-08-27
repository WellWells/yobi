import React from 'react';
import { Box, Loader, Stack, Text } from '@mantine/core';
import { Check, X } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';
import type { AgentTraceTurn } from '../store/useAgentRunStore';

const HIDDEN_CONFIG_KEYS = new Set(['provider']);

const SUBLINE_INDENT = 30;

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
  if (turn.stage && turn.stage.label !== 'read') {
    lines.push(t(`agent.stage.${turn.stage.label}`).replace('{{detail}}', turn.stage.detail ?? ''));
  }
  if (turn.read && turn.read.length > 0) {
    lines.push(t('agent.stage.readHosts').replace('{{hosts}}', turn.read.join(', ')));
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
  const icon = turn.status === 'ok'
    ? <Check size={11} color="var(--mantine-color-teal-6)" />
    : turn.status === 'error'
      ? <X size={11} color="var(--mantine-color-red-6)" />
      : <Loader size={10} />;
  const config = configText(turn.config);
  const lines = subLines(turn, t);
  const label = turn.tool
    ?? (turn.provider
      ? t('agent.trace.asking').replace('{{provider}}', turn.provider)
      : t('agent.trace.thinking'));

  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Text component="span" style={{ fontSize: 'var(--font-size-xs)', color: 'var(--mantine-color-dimmed)', width: 12, textAlign: 'right', flexShrink: 0 }}>
          {turn.turn}
        </Text>
        <Box component="span" style={{ flexShrink: 0, display: 'inline-flex' }}>{icon}</Box>
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
        <Text key={line} component="span" pl={SUBLINE_INDENT} style={SUBLINE_STYLE}>{line}</Text>
      ))}
    </Stack>
  );
}

export const AgentTraceRows: React.FC<{ trace: AgentTraceTurn[] }> = ({ trace }) => (
  <Box style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 2 }}>
    {trace.map((turn) => (
      <AgentTraceRow key={turn.turn} turn={turn} />
    ))}
  </Box>
);
