import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { NotebookText, X } from 'lucide-react';
import { GroupHeader } from '../GroupHeader';

interface RecapLineProps {
  title: string;
  /** The recap's lines, or empty for "no recap yet". */
  lines: readonly string[];
  emptyText: string;
  /** When the conversation was last at this point; '' when unknown. */
  timeLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
}

/**
 * Where the conversation stood, above the composer. Not the AgentResumeBanner's `History` glyph:
 * the two rows can stack in the same slot.
 */
export function RecapLine({ title, lines, emptyText, timeLabel, dismissLabel, onDismiss }: RecapLineProps) {
  return (
    <Box style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap={8}>
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Group gap={8} wrap="nowrap">
            <GroupHeader variant="plain" icon={<NotebookText size={14} />} label={title} />
            {timeLabel && (
              <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {timeLabel}
              </Text>
            )}
          </Group>
          {lines.length > 0
            ? lines.map((line, index) => <Text key={index} size="sm">{line}</Text>)
            : <Text size="sm" c="var(--text-muted)">{emptyText}</Text>}
        </Stack>
        <Tooltip label={dismissLabel}>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={dismissLabel} onClick={onDismiss} style={{ flexShrink: 0 }}>
            <X size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
