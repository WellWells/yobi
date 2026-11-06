import React from 'react';
import { Box, Group, Loader, Stack, Text } from '@mantine/core';
import { Square, Terminal } from 'lucide-react';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { AppButton } from '../AppButton';
import { CollapsibleContent } from './CollapsibleContent';
import { SHELL_COLOR } from './composerFrame';

interface ShellBubbleProps {
  command: string;
  output: string;
  t: (key: string) => string;
  shellLabel?: string;
  folder?: string;
  exitCode?: number | null;
  stopped?: boolean;
  running?: boolean;
  onStop?: () => void;
  /** In the side-by-side layout's question column: no bubble of its own. */
  bare?: boolean;
}

const MONO_TEXT = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
  fontFamily: 'var(--font-mono, monospace)',
} as const;

function StatusText({ exitCode, stopped, running, t }: Pick<ShellBubbleProps, 'exitCode' | 'stopped' | 'running' | 't'>) {
  if (running) {
    return (
      <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Loader size={12} />
        <Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)">{t('chat.shell.running')}</Text>
      </Group>
    );
  }
  if (stopped) {
    return <Text component="span" fz="var(--font-size-xs)" c="var(--mantine-color-warning)" style={{ flexShrink: 0 }}>{t('chat.shell.stopped')}</Text>;
  }
  if (exitCode === undefined || exitCode === null) return null;
  return (
    <Text
      component="span"
      fz="var(--font-size-xs)"
      c={exitCode === 0 ? 'var(--text-muted)' : 'var(--mantine-color-error)'}
      style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
    >
      {fillTemplate(t('chat.shell.exitCode'), { code: String(exitCode) })}
    </Text>
  );
}

/** A `!` command the user ran: the command line, where it ran, how it ended, and what it printed. */
export const ShellBubble = React.memo<ShellBubbleProps>(({
  command, output, t, shellLabel, folder, exitCode, stopped, running = false, onStop, bare = false,
}) => {
  const place = [shellLabel, folder].filter(Boolean).join(' · ');
  const body = (
    <Stack gap={8}>
      <Group gap={6} wrap="nowrap" c="var(--text-muted)" style={{ minWidth: 0 }}>
        <Terminal size={14} style={{ flexShrink: 0 }} />
        {place && (
          <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate="end" title={place} style={{ minWidth: 0 }}>
            {place}
          </Text>
        )}
        <StatusText exitCode={exitCode} stopped={stopped} running={running} t={t} />
      </Group>
      <Box data-find-scope>
        <Text className="selectable" fz="var(--font-size-sm)" fw={500} c="var(--text-primary)" style={MONO_TEXT}>
          <Text span inherit c={SHELL_COLOR}>!</Text>
          {` ${command}`}
        </Text>
      </Box>
      {output ? (
        <CollapsibleContent fadeColor={bare ? 'var(--bg-primary)' : 'var(--bg-secondary)'} t={t}>
          <Box data-find-scope>
            <Text className="selectable" fz="var(--font-size-xs)" lh={1.6} c="var(--text-secondary)" style={MONO_TEXT}>
              {output}
            </Text>
          </Box>
        </CollapsibleContent>
      ) : !running ? (
        <Text fz="var(--font-size-xs)" c="var(--text-muted)">{t('chat.shell.noOutput')}</Text>
      ) : null}
      {running && onStop && (
        <Group justify="flex-end">
          <AppButton size="xs" variant="default" leftSection={<Square size={12} />} onClick={onStop}>
            {t('chat.shell.stop')}
          </AppButton>
        </Group>
      )}
    </Stack>
  );

  if (bare) return body;
  return (
    <Box
      ml="auto"
      w="80%"
      maw="80%"
      bg="var(--bg-secondary)"
      px={16}
      py={10}
      style={{ borderRadius: 'var(--mantine-radius-lg)', border: '1px solid var(--border)' }}
    >
      {body}
    </Box>
  );
});

ShellBubble.displayName = 'ShellBubble';
