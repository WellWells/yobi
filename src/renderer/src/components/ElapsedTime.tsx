import { useEffect, useState } from 'react';
import { Text } from '@mantine/core';
import { useI18nStore } from '../store/i18nStore';
import { formatTraceElapsed } from '../utils/agentTrace';

const TICK_MS = 1_000;

const TRAILING_STYLE = { flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 'inherit' } as const;

export interface ElapsedTimeProps {
  /** Still running: counts up from here every second. */
  startedAt?: number;
  /** Ended: how long it took. */
  durationMs?: number;
}

/**
 * The elapsed time, on its own so each second redraws only this. Hidden from screen readers: the
 * label next to it says what is happening, and a number that changes every second is noise there.
 */
export function ElapsedTime({ startedAt, durationMs }: ElapsedTimeProps) {
  const t = useI18nStore((state) => state.t);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsedMs = startedAt !== undefined ? now - startedAt : durationMs;
  if (elapsedMs === undefined) return null;
  return <Text component="span" aria-hidden style={TRAILING_STYLE}>{formatTraceElapsed(elapsedMs, t)}</Text>;
}
