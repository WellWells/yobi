import React, { useState } from 'react';
import { Box, Menu as MMenu, Stack, Text } from '@mantine/core';
import { useFileDialog } from '@mantine/hooks';
import { ArrowDownUp, CalendarDays, Download, FileUp, FolderPlus, SlidersHorizontal } from 'lucide-react';
import { CONVERSATION_SORTS, isConversationSort } from '../../../../shared/sidebarView';
import { useSidebarViewStore } from '../../store/sidebarViewStore';
import { NotionIcon } from '../../config/brandIcons';
import { ToolbarIconButton } from '../PanelToolbar';
import { ToggleSwitch } from '../ToggleSwitch';
import { NotionImportDialog } from './NotionImportDialog';
import { IMPORT_ACCEPT } from './useConversationImport';

interface SidebarViewMenuProps {
  onNewFolder: () => void;
  /** Markdown files picked from this computer: the same import as dropping them on the list. */
  onPickFiles: (files: File[]) => void;
  /** Opens a document Notion import wrote (or found already kept). */
  onOpenImported: (path: string) => void;
  t: (key: string) => string;
}

/**
 * The sidebar toolbar's one menu button, beside the search field: what adds to the list (Import ▸
 * from this computer or a Notion page, which then stays in sync; a new folder), then Apple Notes'
 * View options — Sort By ▸ and Group by Date, the same switch as everywhere else. The sort applies
 * at the top level and inside folders; the pinned group always keeps latest activity.
 */
export const SidebarViewMenu: React.FC<SidebarViewMenuProps> = ({ onNewFolder, onPickFiles, onOpenImported, t }) => {
  const view = useSidebarViewStore((s) => s.view);
  const setSidebarView = useSidebarViewStore((s) => s.setSidebarView);
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
      <MMenu position="bottom-end" offset={4} withinPortal shadow="md" width={240}>
        <MMenu.Target>
          <ToolbarIconButton icon={SlidersHorizontal} label={t('sidebar.view.tooltip')} onClick={() => undefined} />
        </MMenu.Target>
        <MMenu.Dropdown>
          <MMenu.Sub position="right-start">
            <MMenu.Sub.Target>
              <MMenu.Sub.Item leftSection={<Download size={14} />}>{t('sidebar.import.menu')}</MMenu.Sub.Item>
            </MMenu.Sub.Target>
            <MMenu.Sub.Dropdown w={280}>
              <MMenu.Item leftSection={<FileUp size={14} />} onClick={filePicker.open}>
                {t('sidebar.import.local')}
              </MMenu.Item>
              <MMenu.Item leftSection={<NotionIcon size={14} />} onClick={() => setNotionOpen(true)}>
                <Stack gap={2}>
                  <Text fz="inherit">{t('sidebar.import.notion')}</Text>
                  <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{t('sidebar.import.notionHint')}</Text>
                </Stack>
              </MMenu.Item>
            </MMenu.Sub.Dropdown>
          </MMenu.Sub>
          <MMenu.Item leftSection={<FolderPlus size={14} />} onClick={onNewFolder}>
            {t('sidebar.folder.new')}
          </MMenu.Item>
          <MMenu.Divider />
          <MMenu.Sub position="right-start">
            <MMenu.Sub.Target>
              <MMenu.Sub.Item
                leftSection={<ArrowDownUp size={14} />}
                rightSection={<Text fz="var(--font-size-sm)" c="var(--text-muted)">{t(`sidebar.view.sort.${view.sort}`)}</Text>}
              >
                {t('sidebar.view.sortBy')}
              </MMenu.Sub.Item>
            </MMenu.Sub.Target>
            <MMenu.Sub.Dropdown miw={160}>
              <MMenu.RadioGroup
                value={view.sort}
                onChange={(value) => { if (isConversationSort(value)) setSidebarView({ sort: value }); }}
              >
                {CONVERSATION_SORTS.map((sort) => (
                  <MMenu.RadioItem key={sort} value={sort}>{t(`sidebar.view.sort.${sort}`)}</MMenu.RadioItem>
                ))}
              </MMenu.RadioGroup>
            </MMenu.Sub.Dropdown>
          </MMenu.Sub>
          {/* The same switch as the settings page; the whole row toggles it and the menu stays open. */}
          <MMenu.Item
            closeMenuOnClick={false}
            leftSection={<CalendarDays size={14} />}
            rightSection={(
              <Box style={{ pointerEvents: 'none' }}>
                <ToggleSwitch
                  size="sm"
                  checked={view.groupByDate}
                  onChange={() => {}}
                  tabIndex={-1}
                  aria-label={t('sidebar.view.groupByDate')}
                />
              </Box>
            )}
            onClick={() => setSidebarView({ groupByDate: !view.groupByDate })}
          >
            {t('sidebar.view.groupByDate')}
          </MMenu.Item>
        </MMenu.Dropdown>
      </MMenu>
      <NotionImportDialog open={notionOpen} onClose={() => setNotionOpen(false)} onImported={onOpenImported} t={t} />
    </>
  );
};
