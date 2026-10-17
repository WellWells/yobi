import React, { useState } from 'react';
import { FileButton, Menu as MMenu, Stack, Text } from '@mantine/core';
import { Download, FileUp } from 'lucide-react';
import { NotionIcon } from '../../config/brandIcons';
import { ToolbarIconButton } from '../PanelToolbar';
import { NotionImportDialog } from './NotionImportDialog';
import { IMPORT_ACCEPT } from './useConversationImport';

interface SidebarImportMenuProps {
  onPickFiles: (files: File[]) => void;
  resetRef: React.RefObject<(() => void) | null>;
  /** Opens a document Notion import wrote (or found already kept). */
  onOpenPath: (path: string) => void;
  t: (key: string) => string;
}

/**
 * The sidebar's import button: Markdown files from this computer (the same import as dropping them
 * on the list), or a Notion page, which then stays in sync with Notion. Import is the inward arrow.
 */
export const SidebarImportMenu: React.FC<SidebarImportMenuProps> = ({ onPickFiles, resetRef, onOpenPath, t }) => {
  const [notionOpen, setNotionOpen] = useState(false);
  return (
    <>
      {/* keepMounted: the file picker's input lives in the dropdown, and the menu closes as the
          system picker opens; unmounted, its change event would never arrive. */}
      <MMenu position="bottom-end" offset={4} withinPortal shadow="md" width={280} keepMounted>
        <MMenu.Target>
          <ToolbarIconButton icon={Download} label={t('sidebar.import.button')} onClick={() => undefined} />
        </MMenu.Target>
        <MMenu.Dropdown>
          <FileButton onChange={onPickFiles} resetRef={resetRef} multiple accept={IMPORT_ACCEPT}>
            {(props) => (
              <MMenu.Item leftSection={<FileUp size={14} />} onClick={props.onClick}>
                {t('sidebar.import.local')}
              </MMenu.Item>
            )}
          </FileButton>
          <MMenu.Item leftSection={<NotionIcon size={14} />} onClick={() => setNotionOpen(true)}>
            <Stack gap={2}>
              <Text fz="inherit">{t('sidebar.import.notion')}</Text>
              <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{t('sidebar.import.notionHint')}</Text>
            </Stack>
          </MMenu.Item>
        </MMenu.Dropdown>
      </MMenu>
      <NotionImportDialog open={notionOpen} onClose={() => setNotionOpen(false)} onImported={onOpenPath} t={t} />
    </>
  );
};
