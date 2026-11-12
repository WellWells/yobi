import type { MouseEvent } from 'react';
import { Box, Loader, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { releaseFollow } from '../../hooks/useStickToBottom';
import { ElapsedTime } from '../ElapsedTime';
import type { ElapsedTimeProps } from '../ElapsedTime';

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: '100%',
  alignSelf: 'flex-start',
  fontSize: 'var(--font-size-sm)',
} as const;

/** The part of the line that moves while a step runs: it keeps its width, counts do not jump. */
const PHASE_STYLE = { flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } as const;

interface TraceHeaderProps extends ElapsedTimeProps {
  title: string;
  /** Where the running step has got to, in a few words (`pendingPhase`). */
  phase?: string;
  running?: boolean;
  open?: boolean;
  /** Absent while there is nothing to expand: the line is then not a control. */
  onToggle?: () => void;
}

/**
 * The one line an `/agent` run shows, running and finished. Nothing sits before the title, so it
 * keeps its place when the spinner goes; the title is what gives way in a narrow window, never the
 * phase after it.
 */
export function TraceHeader({ title, phase, running, startedAt, durationMs, open, onToggle }: TraceHeaderProps) {
  const content = (
    <>
      <Text component="span" truncate fz="inherit" fw={500} title={title} style={{ minWidth: 0 }}>{title}</Text>
      {phase && (
        <Text component="span" fz="inherit" c="var(--text-muted)" style={PHASE_STYLE} data-trace-phase>
          {`· ${phase}`}
        </Text>
      )}
      <ElapsedTime startedAt={startedAt} durationMs={durationMs} />
      {running && <Loader size={12} style={{ flexShrink: 0 }} />}
      {onToggle && (open
        ? <ChevronDown size={13} style={{ flexShrink: 0 }} />
        : <ChevronRight size={13} style={{ flexShrink: 0 }} />)}
    </>
  );
  const runningMark = running ? { 'data-trace-running': true } : {};

  if (!onToggle) return <Box c="var(--text-secondary)" style={ROW_STYLE} {...runningMark}>{content}</Box>;

  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    // Opening grows the page under the reader: following the bottom would push this line away.
    if (!open) releaseFollow(event.currentTarget);
    onToggle();
  };
  return (
    <UnstyledButton
      c="var(--text-secondary)"
      aria-expanded={Boolean(open)}
      onClick={toggle}
      style={ROW_STYLE}
      {...runningMark}
    >
      {content}
    </UnstyledButton>
  );
}
