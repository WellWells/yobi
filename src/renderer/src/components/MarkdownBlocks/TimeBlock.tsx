import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { Clock } from 'lucide-react';
import dayjs from 'dayjs';

interface TimeBlockProps {
  time: string;
  provider?: string | null;
}

function formatDisplayTime(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) return '';
  const parsed = dayjs(normalized);
  if (parsed.isValid()) return parsed.format('YYYY-MM-DD HH:mm:ss');
  const fallbackParsed = dayjs(normalized.replace(' ', 'T'));
  return fallbackParsed.isValid() ? fallbackParsed.format('YYYY-MM-DD HH:mm:ss') : normalized;
}

export const TimeBlock = React.memo<TimeBlockProps>(({ time, provider }) => {
  const displayTime = formatDisplayTime(time);
  return (
    <Group
      gap={6}
      align="center"
      wrap="wrap"
      style={{
        padding: '4px 0 10px',
        color: 'var(--text-muted)',
        fontSize: 'var(--font-size-sm)',
      }}
    >
      {provider && (
        <Box style={{
          width: 'fit-content',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          background: 'var(--bg-tertiary)',
          borderRadius: 999,
          padding: '1px 7px',
          letterSpacing: 0.2,
        }}>
          {provider}
        </Box>
      )}
      {displayTime && (
        <>
          <Clock size={13} style={{ opacity: 0.75, marginTop: 1 }} />
          <Text span style={{
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.4px',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}>
            {displayTime}
          </Text>
        </>
      )}
    </Group>
  );
});

