import React, { useMemo } from 'react';
import { Group, HoverCard, Menu as MMenu, Stack, Text } from '@mantine/core';
import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { useI18nStore } from '../../../store/i18nStore';
import { summarizeConversation } from '../../../utils/conversationInfo';
import { conversationWordCount } from './headerMenuModel';
import { infoCardRows, infoMenuLines, valueSegments } from './infoAreaModel';

export interface HeaderMenuInfoProps {
  t: (key: string) => string;
  conversation: ConversationDoc;
  content: string;
  filePath: string;
  /** Opens the full "Conversation info" dialog; a click or Enter on the row. */
  onOpenInfo: () => void;
  onClose: () => void;
}

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;
const NO_WRAP = { whiteSpace: 'nowrap', flexShrink: 0 } as const;
/** Long enough that moving the pointer down the menu past the row does not flash the card. */
const CARD_OPEN_DELAY_MS = 400;
/** Wide enough for the duration row's parts and a path of INFO_CARD_PATH_CHARS on one line each. */
const CARD_WIDTH = 300;

/**
 * The bottom of the ⋮ menu, as in Notion: the conversation's size and last reply in two muted
 * lines, a compact card of the info dialog on hover, and the full dialog on click or Enter, so
 * keyboard users reach everything the card shows. Mounted only while the menu is open, so a long
 * conversation is not counted on every new turn.
 */
export const HeaderMenuInfo: React.FC<HeaderMenuInfoProps> = ({ t, conversation, content, filePath, onOpenInfo, onClose }) => {
  const locale = useI18nStore((s) => s.locale);
  const info = useMemo(() => summarizeConversation(conversation, content), [conversation, content]);
  const words = useMemo(() => conversationWordCount(conversation.turns), [conversation.turns]);
  const lines = infoMenuLines(info, words, t, locale);
  const rows = infoCardRows(info, filePath, t, locale);

  return (
    // Not in a portal: a click inside the card must not count as a click outside the menu. The
    // ⋮ sits at the window's right edge, so the card opens to the left, level with the row's bottom.
    <HoverCard
      position="left-end"
      offset={10}
      openDelay={CARD_OPEN_DELAY_MS}
      withinPortal={false}
      withRoles={false}
      width={CARD_WIDTH}
      shadow="md"
    >
      <HoverCard.Target>
        <MMenu.Item
          data-header-info
          onClick={() => {
            onOpenInfo();
            onClose();
          }}
        >
          <Stack gap={2} fz="var(--font-size-sm)" c="var(--text-muted)" style={NUMERIC}>
            <Text inherit>{lines.stats}</Text>
            {lines.lastReply && <Text inherit>{lines.lastReply}</Text>}
          </Stack>
        </MMenu.Item>
      </HoverCard.Target>
      <HoverCard.Dropdown
        bg="var(--bg-secondary)"
        p={12}
        style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}
      >
        <Stack gap={8}>
          {rows.map((row) => (
            <Stack key={row.key} gap={2}>
              <Group justify="space-between" align="flex-start" gap={12} wrap="nowrap">
                <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={NO_WRAP}>{row.label}</Text>
                <Stack gap={0} align="flex-end" style={{ minWidth: 0 }}>
                  {row.values.map((value) => (
                    // Wraps only between the " · " parts; a part ("longest 1 min 5 s") stays whole.
                    <Text key={value} fz="var(--font-size-sm)" c="var(--text-primary)" ta="right" style={NUMERIC}>
                      {valueSegments(value).map((part, index) => (
                        <React.Fragment key={index}>
                          {index > 0 && ' '}
                          <Text span inherit style={NO_WRAP}>{part}</Text>
                        </React.Fragment>
                      ))}
                    </Text>
                  ))}
                </Stack>
              </Group>
              {/* The path on one line of its own, already cut in the middle; the ellipsis only guards wide characters. */}
              {row.detail && (
                <Text fz="var(--font-size-xs)" c="var(--text-muted)" ff="var(--font-mono)" truncate="end" title={filePath}>
                  {row.detail}
                </Text>
              )}
            </Stack>
          ))}
          <Text fz="var(--font-size-xs)" c="var(--text-muted)">{t('header.menu.info.openHint')}</Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
};
