import React from 'react';
import { Menu as MMenu, Stack, Text } from '@mantine/core';
import {
  Copy, FileCode, FileImage, FolderOpen, Globe, History, Link2, RefreshCw, Share2, Upload,
  type LucideIcon,
} from 'lucide-react';
import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { conversationPlainMarkdown } from '../../../../../shared/conversationPlain';
import { canVersionConversation } from '../../../../../shared/conversationHistory';
import { clipboardApi, fileApi } from '../../../api/electronApi';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import { exportConversationMarkdown } from '../../../utils/conversationMarkdownExport';
import { isMac } from '../../../utils/keyLabels';
import { ModelMenuItems } from '../ModelMenuItems';
import { SUB_POSITION, threadLink } from './headerMenuModel';
import { searchRowLabel } from './headerMenuSearch';
import { fillTemplate } from '../../../../../shared/fillTemplate';

const SUB_DROPDOWN_STYLE = { maxHeight: 320, overflowY: 'auto' } as const;

type Translate = (key: string) => string;

export interface HeaderMenuActionsProps {
  t: Translate;
  filePath: string;
  fileContent: string | null;
  conversation: ConversationDoc | null;
  captureBusy: boolean;
  onOpenCaptureDialog: () => void;
  /** The share-link dialog; the menu's Export ▸ is the only way to it. */
  onOpenShareDialog: () => void;
  /** Absent where re-asking means nothing (a Notion document): the row is left out. */
  onStartRewrite?: (url: string) => void;
  /** The caller's own first row (search id `leading`); nothing is drawn without it. */
  leadingAction?: React.ReactNode;
  /**
   * Version history; the row is left out without a handler. A file with neither a title nor a
   * thread marker cannot be given an id, so its row is disabled with the reason.
   */
  onOpenHistory?: () => void;
  /** Slot for "translate the whole conversation ▸", a top-level row; nothing is drawn without it. */
  translateMenu?: React.ReactNode;
  /** The slot's own label, which the search box matches it by. */
  translateMenuLabel?: string;
  /** Something is typed in the search box: Export ▸ is drawn as flat rows. */
  searching: boolean;
  /** Whether a row (by its search id) is drawn. */
  show: (id: string) => boolean;
  onClose: () => void;
}

/** How faded a disabled row's icon and label are; Mantine's own value, applied to them alone. */
const DISABLED_FADE = 0.6;

/**
 * A disabled row that says why on the row itself, not in a tooltip. Mantine fades the whole
 * disabled item, which leaves the muted reason unreadable, so the item stays at full opacity and
 * only the icon and label fade; the reason keeps `--text-muted`. Still `disabled`: not clickable,
 * not focusable.
 */
const DisabledReasonItem: React.FC<{ icon: LucideIcon; label: string; reason: string }> = ({ icon: Icon, label, reason }) => (
  <MMenu.Item leftSection={<Icon size={14} opacity={DISABLED_FADE} />} disabled style={{ opacity: 1 }}>
    <Stack gap={2}>
      <Text inherit opacity={DISABLED_FADE}>{label}</Text>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ whiteSpace: 'normal' }}>{reason}</Text>
    </Stack>
  </MMenu.Item>
);

/** The ⋮ menu's actions on this conversation, above the divider. */
export const HeaderMenuActions: React.FC<HeaderMenuActionsProps> = ({
  t, filePath, fileContent, conversation, captureBusy,
  onOpenCaptureDialog, onOpenShareDialog, onStartRewrite, leadingAction, onOpenHistory, translateMenu, searching, show, onClose,
}) => {
  const hasContent = Boolean(fileContent);
  const link = threadLink(conversation);

  const copy = (text: string, noticeKey: string): void => {
    onClose();
    void clipboardApi.copyText(text).then(() => showAppNotice({ message: t(noticeKey), level: 'success' }));
  };

  const exportMarkdown = (): void => {
    onClose();
    void exportConversationMarkdown(filePath, t);
  };

  // Export ▸'s three items, drawn inside the submenu or, while searching, as flat rows named "Export › …".
  const exportItems: Array<{ id: string; icon: LucideIcon; labelKey: string; run: () => void }> = [
    { id: 'export.card', icon: FileImage, labelKey: 'header.menu.export.card', run: () => { onOpenCaptureDialog(); onClose(); } },
    { id: 'export.markdown', icon: FileCode, labelKey: 'header.menu.export.markdown', run: exportMarkdown },
    { id: 'export.share', icon: Share2, labelKey: 'header.menu.export.share', run: () => { onOpenShareDialog(); onClose(); } },
  ];

  // Only the card capture is busy while one runs; Markdown and the share link do not use it, so
  // they stay available (the sidebar's Export ▸ does the same).
  const renderExportItem = (item: (typeof exportItems)[number], label: string): React.ReactNode => (
    item.id === 'export.card' && captureBusy
      ? <DisabledReasonItem key={item.id} icon={item.icon} label={label} reason={t('capture.exporting')} />
      : <MMenu.Item key={item.id} leftSection={<item.icon size={14} />} onClick={item.run}>{label}</MMenu.Item>
  );

  const renderExport = (): React.ReactNode => {
    if (!hasContent) return null;
    if (searching) {
      return exportItems
        .filter((item) => show(item.id))
        .map((item) => renderExportItem(item, searchRowLabel([t('header.menu.export')], t(item.labelKey))));
    }
    return (
      <MMenu.Sub position={SUB_POSITION}>
        <MMenu.Sub.Target>
          <MMenu.Sub.Item leftSection={<Upload size={14} />}>{t('header.menu.export')}</MMenu.Sub.Item>
        </MMenu.Sub.Target>
        <MMenu.Sub.Dropdown>
          {exportItems.map((item) => renderExportItem(item, t(item.labelKey)))}
        </MMenu.Sub.Dropdown>
      </MMenu.Sub>
    );
  };

  return (
    <>
      {leadingAction && show('leading') && leadingAction}

      {/* Long or dynamic submenus stay submenus while searching, found by their own label. */}
      {hasContent && onStartRewrite && show('reask') && (
        <MMenu.Sub position={SUB_POSITION}>
          <MMenu.Sub.Target>
            <MMenu.Sub.Item leftSection={<RefreshCw size={14} />}>{t('header.menu.reask')}</MMenu.Sub.Item>
          </MMenu.Sub.Target>
          <MMenu.Sub.Dropdown style={SUB_DROPDOWN_STYLE}>
            <ModelMenuItems
              value=""
              onChange={(url) => {
                onStartRewrite(url);
                onClose();
              }}
            />
          </MMenu.Sub.Dropdown>
        </MMenu.Sub>
      )}

      {show('translate') && translateMenu}

      {show('copyPath') && (
        <MMenu.Item leftSection={<Link2 size={14} />} onClick={() => copy(filePath, 'header.menu.copied.path')}>
          {t('header.menu.copyPath')}
        </MMenu.Item>
      )}

      {/* Only a conversation that lives on a provider's website has one; otherwise the row is left out. */}
      {link.available && show('threadUrl') && (
        <MMenu.Item leftSection={<Globe size={14} />} onClick={() => copy(link.url, 'header.menu.copied.threadUrl')}>
          {fillTemplate(t('header.menu.copyThreadUrl'), { provider: link.provider })}
        </MMenu.Item>
      )}

      {hasContent && show('copyFull') && (
        <MMenu.Item
          leftSection={<Copy size={14} />}
          onClick={() => copy(
            conversationPlainMarkdown(fileContent ?? '', { unsupported: t('notion.block.unsupported') }),
            'header.menu.copied.full',
          )}
        >
          {t('header.copyFull')}
        </MMenu.Item>
      )}

      {renderExport()}

      {onOpenHistory && show('history') && (canVersionConversation(fileContent ?? '') ? (
        <MMenu.Item
          leftSection={<History size={14} />}
          onClick={() => {
            onOpenHistory();
            onClose();
          }}
        >
          {t('header.menu.history')}
        </MMenu.Item>
      ) : (
        <DisabledReasonItem
          icon={History}
          label={t('header.menu.history')}
          reason={t('header.menu.history.noneReason')}
        />
      ))}

      {show('showInFolder') && (
        <MMenu.Item
          leftSection={<FolderOpen size={14} />}
          onClick={() => {
            void fileApi.showInFolder(filePath);
            onClose();
          }}
        >
          {t(isMac ? 'header.showInFolder.mac' : 'header.showInFolder')}
        </MMenu.Item>
      )}
    </>
  );
};
