import React from 'react';
import { Group, Text } from '@mantine/core';
import { Clock } from 'lucide-react';
import dayjs from 'dayjs';
import { ProviderTag } from '../ProviderTag';

interface TimeBlockProps {
  time: string;
  provider?: string | null;
}

function formatDisplayTime(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) return '';
  const parsed = dayjs(normalized);
  if (parsed.isValid()) return parsed.format('YYYY-MM-DD HH:mm');
  const fallbackParsed = dayjs(normalized.replace(' ', 'T'));
  return fallbackParsed.isValid() ? fallbackParsed.format('YYYY-MM-DD HH:mm') : normalized;
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
      {provider && <ProviderTag provider={provider} />}
      {displayTime && (
        <>
          <Clock size={13} style={{ opacity: 0.75, marginTop: 1 }} />
          <Text span style={{
            fontVariantNumeric: 'tabular-nums',
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

