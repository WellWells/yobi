import React from 'react';
import { Box, Button, Divider, Group, NavLink, ScrollArea, Text } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';
import type { CitationSource } from '../../../../shared/citations';
import { citationHost } from '../../../../shared/citations';
import type { ChatSelectionState } from '../../hooks/useChatSelection';

export interface SelectionAction {
  id: string;
  label: string;
  Icon: LucideIcon;
  run: () => void;
}

interface SelectionToolbarProps {
  selection: ChatSelectionState;
  actions: SelectionAction[];
  sources: CitationSource[];
  sourcesOpen: boolean;
  sourcesLabel: string;
  onOpenSource: (url: string) => void;
  t: (key: string) => string;
}

const MAX_WIDTH = 340;
const EDGE_MARGIN = 12;
const GAP = 10;
const COLLAPSED_HEIGHT = 38;
const EXPANDED_HEIGHT = 268;

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selection,
  actions,
  sources,
  sourcesOpen,
  sourcesLabel,
  onOpenSource,
  t,
}) => {
  const { rect } = selection;
  const needed = (sourcesOpen ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT) + GAP;
  const above = rect.top > needed;
  const half = MAX_WIDTH / 2;
  const centre = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(centre, half + EDGE_MARGIN),
    Math.max(window.innerWidth - half - EDGE_MARGIN, half + EDGE_MARGIN),
  );

  return (
    <Box
      pos="fixed"
      top={above ? rect.top - GAP : rect.bottom + GAP}
      left={left}
      maw={MAX_WIDTH}
      bg="var(--bg-tertiary)"
      onMouseDown={(event) => event.preventDefault()}
      style={{
        zIndex: 130,
        transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
      }}
    >
      <Group gap={0} wrap="nowrap" align="stretch">
        {actions.map(({ id, label, Icon, run }, index) => (
          <React.Fragment key={id}>
            {}
            {index > 0 && <Box my={7} w={1} bg="var(--border)" style={{ flexShrink: 0 }} />}
            <Button
              variant="subtle"
              size="compact-sm"
              radius={0}
              h={COLLAPSED_HEIGHT}
              px={14}
              c="var(--text-primary)"
              leftSection={<Icon size={14} />}
              aria-label={label}
              onClick={run}
              styles={{
                label: { fontSize: 'var(--font-size-base)', fontWeight: 500 },
                section: { marginInlineEnd: 7, color: 'var(--text-muted)' },
              }}
            >
              {label}
            </Button>
          </React.Fragment>
        ))}
      </Group>

      {sourcesOpen && sources.length > 0 && (
        <>
          <Divider color="var(--border)" />
          <Text px={14} pt={10} pb={6} fz="var(--font-size-sm)" fw={600} c="var(--text-muted)">
            {sourcesLabel}
          </Text>
          <ScrollArea.Autosize mah={EXPANDED_HEIGHT - COLLAPSED_HEIGHT - 34} type="auto">
            {sources.map((source) => (
              <NavLink
                key={source.id}
                label={source.title}
                description={citationHost(source.url)}
                px={14}
                py={7}
                leftSection={(
                  <Text fz="var(--font-size-sm)" fw={700} c="var(--text-muted)" w={14} ta="center">
                    {source.id}
                  </Text>
                )}
                aria-label={`${t('chat.selection.openSource')} ${source.title}`}
                onClick={() => onOpenSource(source.url)}
              />
            ))}
          </ScrollArea.Autosize>
        </>
      )}
    </Box>
  );
};
