import React from 'react';
import { ActionIcon, Box, Button, Group, Menu as MMenu, Stack, Text, Tooltip } from '@mantine/core';
import { Copy, Download, FileText, FolderOpen, Link2, Minus, MoreVertical, Pencil, Plus, RefreshCw, ZoomIn } from 'lucide-react';
import type { LayoutMode } from '../../store/appStore';
import { AppTextInput } from '../AppTextInput';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { ChatHeaderRow } from './ChatHeaderRow';
import { ModelMenuItems } from './ModelMenuItems';

interface FileHeaderBarProps {
  fileName: string;
  fileContentExists: boolean;
  headerEditing: boolean;
  headerEditValue: string;
  setHeaderEditValue: (value: string) => void;
  onCommitHeaderRename: () => void;
  onCancelHeaderRename: () => void;
  onStartHeaderRename: () => void;
  headerInputRef: React.RefObject<HTMLInputElement | null>;
  viewMenuRef: React.RefObject<HTMLDivElement | null>;
  viewMenuOpen: boolean;
  onToggleViewMenu: () => void;
  onCloseViewMenu: () => void;
  t: (key: string) => string;
  markdownZoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  layoutMode: LayoutMode;
  onSetLayoutMode: (mode: LayoutMode) => void;
  onCopyFullText: () => void;
  onOpenCaptureDialog: () => void;
  onOpenShareDialog: () => void;
  captureBusy: boolean;
  onShowInFolder: () => void;
  onStartRewrite: (url: string) => void;
}

export const FileHeaderBar: React.FC<FileHeaderBarProps> = ({
  fileName,
  fileContentExists,
  headerEditing,
  headerEditValue,
  setHeaderEditValue,
  onCommitHeaderRename,
  onCancelHeaderRename,
  onStartHeaderRename,
  headerInputRef,
  viewMenuRef,
  viewMenuOpen,
  onToggleViewMenu,
  onCloseViewMenu,
  t,
  markdownZoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  layoutMode,
  onSetLayoutMode,
  onCopyFullText,
  onOpenCaptureDialog,
  onOpenShareDialog,
  captureBusy,
  onShowInFolder,
  onStartRewrite,
}) => {
  const zoomPercentText = `${markdownZoom}%`;

  return (
    <ChatHeaderRow>
      {headerEditing ? (
        <AppTextInput
          ref={headerInputRef}
          value={headerEditValue}
          onChange={(event) => setHeaderEditValue(event.target.value)}
          onBlur={onCommitHeaderRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommitHeaderRename();
            }
            if (event.key === 'Escape') {
              onCancelHeaderRename();
            }
          }}
          variant="default"
          size="xs"
          fw={600}
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
        <Group gap={8} flex={1} style={{ minWidth: 0 }}>
          <Group gap={6} style={{ minWidth: 0, overflow: 'hidden' }}>
            <FileText size={13} />
            <Text
              fz="var(--font-size-base)"
              c="var(--mantine-color-text)"
              fw={600}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'default' }}
            >{fileName}</Text>
          </Group>
          <Tooltip label={t('header.rename')} position="bottom">
            <ActionIcon
              onClick={onStartHeaderRename}
              aria-label={t('header.rename')}
              variant="subtle"
              size="sm"
              c="dimmed"
            >
              <Pencil size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}

      <Group gap={6} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
        {fileContentExists && (
          <Button
            onClick={onOpenShareDialog}
            variant="default"
            size="compact-sm"
            radius="xl"
            leftSection={<Link2 size={14} />}
          >
            {t('share.menu.open')}
          </Button>
        )}

        <Box ref={viewMenuRef} pos="relative">
          <MMenu
            opened={viewMenuOpen}
            onChange={(opened) => { if (!opened) onCloseViewMenu(); }}
            position="bottom-end"
            offset={8}
            withinPortal
            zIndex={120}
            styles={{
              dropdown: {
                background: 'var(--mantine-color-default)',
                borderColor: 'var(--mantine-color-default-border)',
                minWidth: 232,
              },
              item: {
                fontSize: 'var(--font-size-md)',
              },
            }}
          >
            <MMenu.Target>
              <Tooltip label={t('common.moreActions')} position="bottom">
                <ActionIcon
                  onClick={onToggleViewMenu}
                  aria-label={t('common.moreActions')}
                  variant="subtle"
                  size="md"
                  radius="xl"
                  c="dimmed"
                >
                  <MoreVertical size={16} />
                </ActionIcon>
              </Tooltip>
            </MMenu.Target>

            <MMenu.Dropdown>
              {fileContentExists && (
                <MMenu.Sub>
                  <MMenu.Sub.Target>
                    <MMenu.Sub.Item leftSection={<RefreshCw size={14} />}>
                      {t('rewrite.open')}
                    </MMenu.Sub.Item>
                  </MMenu.Sub.Target>
                  <MMenu.Sub.Dropdown
                    style={{ maxHeight: 320, overflowY: 'auto' }}
                  >
                    <ModelMenuItems
                      value=""
                      onChange={(url) => {
                        onStartRewrite(url);
                        onCloseViewMenu();
                      }}
                    />
                  </MMenu.Sub.Dropdown>
                </MMenu.Sub>
              )}

              {fileContentExists && (
                <MMenu.Item
                  leftSection={<Copy size={14} />}
                  onClick={() => {
                    onCopyFullText();
                    onCloseViewMenu();
                  }}
                >
                  {t('header.copyFull')}
                </MMenu.Item>
              )}

              {fileContentExists && (
                <MMenu.Item
                  leftSection={<Download size={14} />}
                  disabled={captureBusy}
                  onClick={() => {
                    onOpenCaptureDialog();
                    onCloseViewMenu();
                  }}
                >
                  {captureBusy ? t('capture.exporting') : t('capture.export.open')}
                </MMenu.Item>
              )}

              <MMenu.Item
                leftSection={<FolderOpen size={14} />}
                onClick={() => {
                  onShowInFolder();
                  onCloseViewMenu();
                }}
              >
                {t('header.showInFolder')}
              </MMenu.Item>

              <MMenu.Divider />

              <Box px={10} py={6}>
                <Stack gap={8}>
                  <Group justify="space-between" gap={10} wrap="nowrap">
                    <Group gap={6} fz="var(--font-size-md)" c="dimmed" align="center" wrap="nowrap">
                      <ZoomIn size={14} />
                      {t('zoom.label')}
                    </Group>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label={t('zoom.out')} position="top">
                        <ActionIcon variant="default" size={26} radius={6} onClick={onZoomOut} aria-label={t('zoom.out')}>
                          <Minus size={13} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t('zoom.reset')} position="top">
                        <Button variant="subtle" size="compact-xs" radius={6} onClick={onZoomReset} miw={52} fw={700}>
                          {zoomPercentText}
                        </Button>
                      </Tooltip>
                      <Tooltip label={t('zoom.in')} position="top">
                        <ActionIcon variant="default" size={26} radius={6} onClick={onZoomIn} aria-label={t('zoom.in')}>
                          <Plus size={13} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  {fileContentExists && (
                    <AppSegmentedControl
                      value={layoutMode}
                      onChange={(value) => {
                        onSetLayoutMode(value as LayoutMode);
                        onCloseViewMenu();
                      }}
                      options={[
                        { label: t('layout.stacked'), value: 'stacked' },
                        { label: t('layout.sideBySide'), value: 'side-by-side' },
                      ]}
                      size="xs"
                      fullWidth
                    />
                  )}
                </Stack>
              </Box>
            </MMenu.Dropdown>
          </MMenu>
        </Box>
      </Group>
    </ChatHeaderRow>
  );
};
