import React from 'react';
import { ActionIcon, Box, Button, Flex, Group, Menu as MMenu, Stack, Text } from '@mantine/core';
import { ChevronDown, Columns2, Copy, Download, FileText, FolderOpen, Menu, Minus, Pencil, Plus, Rows2, ZoomIn } from 'lucide-react';
import type { LayoutMode } from '../../store/appStore';
import { AppTextInput } from '../AppTextInput';
import { AppSegmentedControl } from '../AppSegmentedControl';

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
  captureBusy: boolean;
  onShowInFolder: () => void;
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
  captureBusy,
  onShowInFolder,
}) => {
  const zoomPercentText = `${markdownZoom}%`;

  return (
    <Group
      gap={6}
      wrap="nowrap"
      p="6px 14px"
      bg="var(--mantine-color-default)"
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0, minWidth: 0 }}
    >
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
          <ActionIcon
            onClick={onStartHeaderRename}
            title={t('header.rename')}
            variant="subtle"
            size="sm"
            c="dimmed"
          >
            <Pencil size={13} />
          </ActionIcon>
        </Group>
      )}

      <Box ref={viewMenuRef} pos="relative" ml="auto" style={{ flexShrink: 0 }}>
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
              minWidth: 280,
              padding: 10,
            },
          }}
        >
          <MMenu.Target>
            <Button
              onClick={onToggleViewMenu}
              variant="default"
              size="compact-sm"
              radius="xl"
              rightSection={<ChevronDown size={12} style={{ transform: viewMenuOpen ? 'rotate(180deg)' : 'none' }} />}
              leftSection={<Menu size={14} />}
            >
              {t('header.viewMenu')}
            </Button>
          </MMenu.Target>

          <MMenu.Dropdown>
            <Stack gap={10}>
              <Group justify="space-between" gap={10}>
                <Group gap={6} fw={700} fz="var(--font-size-base)" c="var(--mantine-color-default-color)" align="center">
                  <ZoomIn size={14} />
                  {t('zoom.label')}
                </Group>
                <Group gap={6}>
                  <ActionIcon variant="default" size={28} radius={6} onClick={onZoomOut} title={t('zoom.out')}>
                    <Minus size={14} />
                  </ActionIcon>
                  <Button variant="subtle" size="compact-xs" radius={6} onClick={onZoomReset} title={t('zoom.reset')} miw={56} fw={700}>
                    {zoomPercentText}
                  </Button>
                  <ActionIcon variant="default" size={28} radius={6} onClick={onZoomIn} title={t('zoom.in')}>
                    <Plus size={14} />
                  </ActionIcon>
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

            <MMenu.Divider my={10} />

            <Stack gap={8}>
              {fileContentExists && (
                <Button
                  variant="default"
                  size="sm"
                  fullWidth
                  justify="flex-start"
                  py={8}
                  leftSection={<Copy size={14} />}
                  onClick={() => {
                    onCopyFullText();
                    onCloseViewMenu();
                  }}
                >
                  {t('header.copyFull')}
                </Button>
              )}

              {fileContentExists && (
                <Button
                  variant="default"
                  size="sm"
                  fullWidth
                  justify="flex-start"
                  py={8}
                  leftSection={<Download size={14} />}
                  disabled={captureBusy}
                  onClick={() => {
                    onOpenCaptureDialog();
                    onCloseViewMenu();
                  }}
                >
                  {captureBusy ? t('capture.exporting') : t('capture.export.open')}
                </Button>
              )}

              <Button
                variant="default"
                size="sm"
                fullWidth
                justify="flex-start"
                py={8}
                leftSection={<FolderOpen size={14} />}
                onClick={() => {
                  onShowInFolder();
                  onCloseViewMenu();
                }}
              >
                {t('header.showInFolder')}
              </Button>
            </Stack>
          </MMenu.Dropdown>
        </MMenu>
      </Box>
    </Group>
  );
};

