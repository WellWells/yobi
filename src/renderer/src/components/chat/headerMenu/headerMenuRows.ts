/**
 * The ⋮ menu's searchable rows, in menu order, as data for `planMenuSearch`. The components draw
 * the same rows by the same ids; a row the menu would not draw (no content, no provider thread,
 * no history handler, no layout switch) is not listed, so the empty state is honest.
 */
import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { READING_FONTS } from '../../../../../shared/readingPrefs';
import { isMac } from '../../../utils/keyLabels';
import { threadLink } from './headerMenuModel';
import type { HeaderMenuSearchRow } from './headerMenuSearch';
import { fillTemplate } from '../../../../../shared/fillTemplate';

type Translate = (key: string) => string;

export interface ActionRowsInput {
  t: Translate;
  fileContent: string | null;
  conversation: ConversationDoc | null;
  hasHistory: boolean;
  /** Given only when the translate slot is drawn. */
  translateMenuLabel?: string;
  /** False where re-asking means nothing (a Notion document); the row is left out. */
  canReask?: boolean;
  /** Given only when the caller's own first row is drawn (a document's "refresh from Notion"). */
  leadingLabel?: string;
}

/**
 * Above the divider. Export ▸ is listed as its three items under the parent's name, as the search
 * draws them; re-ask and translate stay one row each (their lists are long or dynamic).
 */
export function headerActionSearchRows({
  t, fileContent, conversation, hasHistory, translateMenuLabel, canReask = true, leadingLabel,
}: ActionRowsInput): HeaderMenuSearchRow[] {
  const hasContent = Boolean(fileContent);
  const link = threadLink(conversation);
  const exportParents = [t('header.menu.export')];
  const rows: Array<HeaderMenuSearchRow | false> = [
    leadingLabel !== undefined && { id: 'leading', side: 'actions', labels: leadingLabel },
    hasContent && canReask && { id: 'reask', side: 'actions', labels: t('header.menu.reask') },
    translateMenuLabel !== undefined && { id: 'translate', side: 'actions', labels: translateMenuLabel },
    { id: 'copyPath', side: 'actions', labels: t('header.menu.copyPath') },
    link.available && {
      id: 'threadUrl', side: 'actions', labels: fillTemplate(t('header.menu.copyThreadUrl'), { provider: link.provider }),
    },
    hasContent && { id: 'copyFull', side: 'actions', labels: t('header.copyFull') },
    hasContent && { id: 'export.card', side: 'actions', labels: t('header.menu.export.card'), parents: exportParents },
    hasContent && { id: 'export.markdown', side: 'actions', labels: t('header.menu.export.markdown'), parents: exportParents },
    hasContent && { id: 'export.share', side: 'actions', labels: t('header.menu.export.share'), parents: exportParents },
    hasHistory && { id: 'history', side: 'actions', labels: t('header.menu.history') },
    // "Show in Finder" on macOS.
    { id: 'showInFolder', side: 'actions', labels: t(isMac ? 'header.showInFolder.mac' : 'header.showInFolder') },
  ];
  return rows.filter((row): row is HeaderMenuSearchRow => Boolean(row));
}

/** Below the divider. Font ▸ is listed as its choices under the parent's name. */
export function headerDisplaySearchRows(t: Translate, showLayout: boolean): HeaderMenuSearchRow[] {
  const fontParents = [t('reading.font')];
  const rows: HeaderMenuSearchRow[] = [
    ...READING_FONTS.map((font): HeaderMenuSearchRow => ({
      id: `font.${font}`, side: 'display', labels: t(`reading.font.${font}`), parents: fontParents,
    })),
    { id: 'fullWidth', side: 'display', labels: t('reading.fullWidth') },
    // The zoom and layout controls have no row of their own; they are found by the words on them.
    { id: 'zoom', side: 'display', labels: [t('header.menu.zoom'), t('zoom.in'), t('zoom.out')] },
  ];
  if (showLayout) {
    rows.push({ id: 'layout', side: 'display', labels: [t('header.menu.layout'), t('layout.stacked'), t('layout.sideBySide')] });
  }
  return rows;
}
