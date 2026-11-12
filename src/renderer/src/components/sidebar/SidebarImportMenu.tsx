import React, { useState } from 'react';
import { Menu as MMenu, Stack, Text } from '@mantine/core';
import { useFileDialog } from '@mantine/hooks';
import { ChevronDown, Download } from 'lucide-react';
import { NotionIcon } from '../../config/brandIcons';
import { ToolbarIconButton } from '../PanelToolbar';
import { NotionImportDialog } from './NotionImportDialog';
import { IMPORT_ACCEPT } from './useConversationImport';

interface SidebarImportMenuProps {
  /** Markdown files picked from this computer: the same import as dropping them on the list. */
  onPickFiles: (files: File[]) => void;
  /** Opens a document Notion import wrote (or found already kept). */
  onOpenImported: (path: string) => void;
  t: (key: string) => string;
}

/**
 * The ▾ at the end of the 「新對話」 row: the other ways a conversation gets into the list, from
 * this computer or from a Notion page (which then stays in sync) — the same shape as the flow
 * sidebar's 「新增流程 ▾」. Dropping files on the list is the same import. How the list is ordered
 * and filtered lives on the 「對話」 heading, and a new folder on the 「資料夾」 one.
 */
export const SidebarImportMenu: React.FC<SidebarImportMenuProps> = ({ onPickFiles, onOpenImported, t }) => {
  const [notionOpen, setNotionOpen] = useState(false);
  // A fresh input on document.body for every pick: it outlives the menu closing as the system
  // picker opens, and picking the same file again still fires.
  const filePicker = useFileDialog({
    multiple: true,
    accept: IMPORT_ACCEPT,
    onChange: (files) => { if (files?.length) onPickFiles(Array.from(files)); },
  });
  return (
    <>
      <MMenu position="bottom-end" offset={4} withinPortal shadow="md" width={280}>
        <MMenu.Target>
          <ToolbarIconButton icon={ChevronDown} label={t('chat.new.more')} onClick={() => undefined} />
        </MMenu.Target>
        <MMenu.Dropdown>
          <MMenu.Item leftSection={<Download size={14} />} onClick={filePicker.open}>
            {t('sidebar.import.local')}
          </MMenu.Item>
          <MMenu.Item leftSection={<NotionIcon size={14} />} onClick={() => setNotionOpen(true)}>
            <Stack gap={2}>
              <Text fz="inherit">{t('sidebar.import.notion')}</Text>
              <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{t('sidebar.import.notionHint')}</Text>
            </Stack>
          </MMenu.Item>
        </MMenu.Dropdown>
      </MMenu>
      <NotionImportDialog open={notionOpen} onClose={() => setNotionOpen(false)} onImported={onOpenImported} t={t} />
    </>
  );
};
