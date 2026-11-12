import { ActionIcon, Box, HoverCard } from '@mantine/core';
import { NotebookText } from 'lucide-react';
import { RecapBody } from './RecapLine';

interface RecapButtonProps {
  title: string;
  lines: readonly string[];
  emptyText: string;
  timeLabel: string;
  /** Armed by coming back: the icon takes the accent tint until its card has been opened. */
  fresh: boolean;
  /** The card has opened, so the recap it was armed for counts as read. */
  onSeen: () => void;
}

/** Long enough that a pointer crossing the icon on its way to the composer does not flash the card. */
const CARD_OPEN_DELAY_MS = 250;
const CARD_CLOSE_DELAY_MS = 150;
const CARD_WIDTH = 360;
/** Touch too: the icon has no tap action of its own. */
const EVENTS = { hover: true, focus: true, touch: true } as const;

/**
 * The recap as a small icon floating over the conversation's bottom-right corner, above the
 * composer: hovering (or focusing) it opens the card. Coming back only tints it; the line that
 * opens by itself above the composer is kept for `/recap`.
 */
export function RecapButton({ title, lines, emptyText, timeLabel, fresh, onSeen }: RecapButtonProps) {
  return (
    <HoverCard
      position="top-end"
      offset={8}
      openDelay={CARD_OPEN_DELAY_MS}
      closeDelay={CARD_CLOSE_DELAY_MS}
      events={EVENTS}
      width={CARD_WIDTH}
      shadow="md"
      onOpen={onSeen}
    >
      <HoverCard.Target>
        <ActionIcon
          data-recap-button
          variant={fresh ? 'light' : 'default'}
          radius="xl"
          size={30}
          aria-label={title}
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <NotebookText size={15} />
        </ActionIcon>
      </HoverCard.Target>
      <HoverCard.Dropdown
        bg="var(--bg-secondary)"
        p={12}
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
      >
        <Box maw={CARD_WIDTH}>
          <RecapBody title={title} lines={lines} emptyText={emptyText} timeLabel={timeLabel} />
        </Box>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
