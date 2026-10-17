import React from 'react';
import { Box, Group } from '@mantine/core';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import { ChatHeaderRow } from './ChatHeaderRow';
import { HeaderTitleField } from './HeaderTitleField';
import { HeaderMenuDropdown } from './headerMenu/HeaderMenuDropdown';
import { HeaderMoreMenu } from './headerMenu/HeaderMoreMenu';

interface FileHeaderBarProps {
  /** The conversation's H1 (the file name without `.md` when it has none); see `conversationHeaderTitle`. */
  title: string;
  filePath: string;
  fileContent: string | null;
  /** The parsed conversation; `null` for a file that is not one. */
  conversation: ConversationDoc | null;
  titleEditing: boolean;
  titleEditValue: string;
  setTitleEditValue: (value: string) => void;
  onCommitTitleEdit: () => void;
  onCancelTitleEdit: () => void;
  onStartTitleEdit: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  viewMenuRef: React.RefObject<HTMLDivElement | null>;
  viewMenuOpen: boolean;
  onToggleViewMenu: () => void;
  onCloseViewMenu: () => void;
  t: (key: string) => string;
  onOpenCaptureDialog: () => void;
  /** The share-link dialog, reached through ⋮ › Export ▸. */
  onOpenShareDialog: () => void;
  captureBusy: boolean;
  onStartRewrite: (url: string) => void;
  /** Absent when the open file is not a conversation with turns; the menu's info area needs one. */
  onOpenInfo?: () => void;
  /** Version history; the menu row appears only once a handler is given. */
  onOpenHistory?: () => void;
  /** "Translate the whole conversation ▸", a top-level row of the ⋮ menu; nothing is drawn without it. */
  translateMenu?: React.ReactNode;
  /** What the menu's search box matches the translate row by. */
  translateMenuLabel?: string;
}

export const FileHeaderBar: React.FC<FileHeaderBarProps> = ({
  title,
  filePath,
  fileContent,
  conversation,
  titleEditing,
  titleEditValue,
  setTitleEditValue,
  onCommitTitleEdit,
  onCancelTitleEdit,
  onStartTitleEdit,
  titleInputRef,
  viewMenuRef,
  viewMenuOpen,
  onToggleViewMenu,
  onCloseViewMenu,
  t,
  onOpenCaptureDialog,
  onOpenShareDialog,
  captureBusy,
  onStartRewrite,
  onOpenInfo,
  onOpenHistory,
  translateMenu,
  translateMenuLabel,
}) => (
  <ChatHeaderRow>
    <HeaderTitleField
      title={title}
      titleEditing={titleEditing}
      titleEditValue={titleEditValue}
      setTitleEditValue={setTitleEditValue}
      onCommitTitleEdit={onCommitTitleEdit}
      onCancelTitleEdit={onCancelTitleEdit}
      onStartTitleEdit={onStartTitleEdit}
      titleInputRef={titleInputRef}
      t={t}
    />

    <Group gap={6} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
      <Box ref={viewMenuRef} pos="relative">
        <HeaderMoreMenu opened={viewMenuOpen} onToggle={onToggleViewMenu} onClose={onCloseViewMenu} t={t}>
          {/* Search on top, actions above the divider, display settings below, the info area last. */}
          <HeaderMenuDropdown
            t={t}
            filePath={filePath}
            fileContent={fileContent}
            conversation={conversation}
            captureBusy={captureBusy}
            onOpenCaptureDialog={onOpenCaptureDialog}
            onOpenShareDialog={onOpenShareDialog}
            onStartRewrite={onStartRewrite}
            onOpenInfo={onOpenInfo}
            onOpenHistory={onOpenHistory}
            translateMenu={translateMenu}
            translateMenuLabel={translateMenuLabel}
            onClose={onCloseViewMenu}
          />
        </HeaderMoreMenu>
      </Box>
    </Group>
  </ChatHeaderRow>
);
