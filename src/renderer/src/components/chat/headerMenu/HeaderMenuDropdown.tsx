import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Menu as MMenu, Text } from '@mantine/core';
import { Search } from 'lucide-react';
import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { buildInputStyles } from '../../inputStyles';
import { menuDropdownOf, menuItemsOf, setMenuActive } from '../translate/menuSearchNav';
import { HeaderMenuActions } from './HeaderMenuActions';
import { HeaderMenuDisplay } from './HeaderMenuDisplay';
import { HeaderMenuInfo } from './HeaderMenuInfo';
import { headerActionSearchRows, headerDisplaySearchRows } from './headerMenuRows';
import { firstSearchMatch, planMenuSearch } from './headerMenuSearch';

export interface HeaderMenuDropdownProps {
  t: (key: string) => string;
  filePath: string;
  fileContent: string | null;
  conversation: ConversationDoc | null;
  captureBusy: boolean;
  onOpenCaptureDialog: () => void;
  onOpenShareDialog: () => void;
  /** Absent where re-asking means nothing (a Notion document): the row is left out. */
  onStartRewrite?: (url: string) => void;
  /** The caller's own first row (a document's "refresh from Notion"), found by `label`. */
  leadingAction?: { label: string; node: React.ReactNode };
  /** The layout switch; on by default where there is content, off for a document (it has no question). */
  showLayout?: boolean;
  /** Absent when the open file is not a conversation with turns; the info area is left out then. */
  onOpenInfo?: () => void;
  onOpenHistory?: () => void;
  translateMenu?: React.ReactNode;
  /** What the search box matches the translate slot by. */
  translateMenuLabel?: string;
  onClose: () => void;
}

// The App* inputs' colours and type, on Mantine's own search bar: it stays flush with the menu's
// top edge (no side borders, square bottom corners), which is how Mantine draws a menu's search.
const APP_INPUT = buildInputStyles();
const SEARCH_STYLES = { input: APP_INPUT.input, section: APP_INPUT.section } as const;

/**
 * Everything inside the ⋮ menu: a search box on top, actions on this conversation, display
 * settings, and the conversation's info at the bottom. Typing flattens the small submenus
 * (Export ▸, Font ▸) into rows named by their path, so a match is one Enter away.
 */
export const HeaderMenuDropdown: React.FC<HeaderMenuDropdownProps> = ({
  t, filePath, fileContent, conversation, captureBusy, onOpenCaptureDialog, onOpenShareDialog,
  onStartRewrite, leadingAction, showLayout: layoutWanted, onOpenInfo, onOpenHistory, translateMenu, translateMenuLabel, onClose,
}) => {
  const [query, setQuery] = useState('');
  const showLayout = (layoutWanted ?? true) && Boolean(fileContent);

  const plan = useMemo(() => planMenuSearch(query, [
    ...headerActionSearchRows({
      t,
      fileContent,
      conversation,
      hasHistory: Boolean(onOpenHistory),
      ...(translateMenu ? { translateMenuLabel: translateMenuLabel ?? '' } : {}),
      canReask: Boolean(onStartRewrite),
      ...(leadingAction ? { leadingLabel: leadingAction.label } : {}),
    }),
    ...headerDisplaySearchRows(t, showLayout),
  ]), [query, t, fileContent, conversation, onOpenHistory, translateMenu, translateMenuLabel, onStartRewrite, leadingAction, showLayout]);
  const show = (id: string): boolean => plan.visible.has(id);

  // Searching hides a side with nothing left on it, and the divider with it.
  const drawActions = !plan.searching || plan.actions;
  const drawDisplay = !plan.searching || plan.display;

  // Typing highlights the first match, so Enter acts on it as in the language search below.
  // Menu.Search clears the highlight on every keystroke; this runs after that render. Zoom and
  // layout are no menu items: a query that finds only them highlights nothing, and Enter does nothing.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!plan.searching) return;
    const dropdown = menuDropdownOf(searchRef.current);
    setMenuActive(dropdown, firstSearchMatch(menuItemsOf(dropdown)));
  }, [plan]);

  return (
    <>
      <MMenu.Search
        ref={searchRef}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={t('header.menu.search')}
        aria-label={t('header.menu.search')}
        leftSection={<Search size={14} />}
        styles={SEARCH_STYLES}
      />

      {drawActions && (
        <HeaderMenuActions
          t={t}
          filePath={filePath}
          fileContent={fileContent}
          conversation={conversation}
          captureBusy={captureBusy}
          onOpenCaptureDialog={onOpenCaptureDialog}
          onOpenShareDialog={onOpenShareDialog}
          onStartRewrite={onStartRewrite}
          leadingAction={leadingAction?.node}
          onOpenHistory={onOpenHistory}
          translateMenu={translateMenu}
          searching={plan.searching}
          show={show}
          onClose={onClose}
        />
      )}
      {drawActions && drawDisplay && <MMenu.Divider />}
      {drawDisplay && (
        <HeaderMenuDisplay t={t} showLayout={showLayout} searching={plan.searching} show={show} onClose={onClose} />
      )}

      {plan.empty && (
        <Text px={12} py={8} fz="var(--font-size-md)" c="var(--text-muted)">{t('header.menu.search.noMatch')}</Text>
      )}

      {/* The info area is the conversation, not an action to find, so a search hides it: left in,
          it was the one row ↓ and Enter could reach when nothing (or only zoom/layout) matched. */}
      {!plan.searching && onOpenInfo && conversation && conversation.turns.length > 0 && (
        <>
          <MMenu.Divider />
          <HeaderMenuInfo
            t={t}
            conversation={conversation}
            content={fileContent ?? ''}
            filePath={filePath}
            onOpenInfo={onOpenInfo}
            onClose={onClose}
          />
        </>
      )}
    </>
  );
};
