import React, { createContext, useContext } from 'react';
import { Group } from '@mantine/core';
import { SquarePen } from 'lucide-react';
import { CAPTION_ROW, captionPad } from '../titlebar/constants';
import { useNarrowWindow } from '../../hooks/useNarrowWindow';
import { useI18nStore } from '../../store/i18nStore';
import { useResolvedCombo } from '../../store/shortcutStore';
import { comboLabel } from '../../../../shared/shortcuts';
import { isMac } from '../../utils/keyLabels';
import { ToolbarIconButton } from '../PanelToolbar';
import { SidebarDrawerButton } from '../SidebarDrawer';

/** The chat view's new conversation, for the narrow window's top row (the sidebar's is in its drawer). */
export const NewConversationContext = createContext<(() => void) | null>(null);

function withCombo(label: string, combo: string): string {
  return combo ? `${label} (${combo})` : label;
}

/**
 * The start of the row while the sidebar is a drawer: the way to it and a new conversation, the
 * two things the sidebar's top gives, as ChatGPT's and Claude's narrow pages keep them.
 */
const NarrowLead: React.FC = () => {
  const onNewConversation = useContext(NewConversationContext);
  const t = useI18nStore((s) => s.t);
  const toggleCombo = comboLabel(useResolvedCombo('view.toggleSidebar'), isMac);
  const newCombo = comboLabel(useResolvedCombo('chat.newConversation'), isMac);
  return (
    <>
      <SidebarDrawerButton label={withCombo(t('sidebar.expand'), toggleCombo)} />
      {onNewConversation && (
        <ToolbarIconButton icon={SquarePen} label={withCombo(t('chat.new'), newCombo)} onClick={onNewConversation} />
      )}
    </>
  );
};

interface ChatHeaderRowProps {
  children: React.ReactNode;
  /**
   * The row reaches the window's right edge, where the caption controls float: true unless a panel
   * opens beside it (a Notion document's writing assistant), whose own top row then leaves the room.
   */
  atWindowEdge?: boolean;
}

/**
 * The conversation's top row, which is also the window's title bar over it. It has the page's own
 * background and no rule, so the conversation reads as one surface with the controls floating at
 * its top, as ChatGPT's and Gemini's do; the rule stays drawn, transparent, so the row keeps the
 * toolbar's 47px and its controls sit on the sidebar toolbar's line. Min-height keeps it steady
 * when the rename input swaps in. In a narrow window it is also the window's left edge (the
 * sidebar is a drawer): it starts with the way to the sidebar, after macOS's traffic lights.
 */
export const ChatHeaderRow: React.FC<ChatHeaderRowProps> = ({ children, atWindowEdge = true }) => {
  const narrow = useNarrowWindow();
  return (
    <Group
      {...CAPTION_ROW}
      gap={6}
      wrap="nowrap"
      mih={47}
      pl={narrow ? captionPad('left', 'left', 8) : 14}
      pr={captionPad(atWindowEdge ? 'right' : undefined, 'right', 14)}
      bg="var(--mantine-color-body)"
      style={{ borderBottom: '1px solid transparent', flexShrink: 0, minWidth: 0 }}
    >
      {narrow && <NarrowLead />}
      {children}
    </Group>
  );
};
