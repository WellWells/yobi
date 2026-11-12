import React, { useState } from 'react';
import { Box, Group } from '@mantine/core';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import { SkillEditorModal } from '../../views/settings/sections/skills/SkillEditorModal';
import type { SkillEditTarget } from '../../views/settings/sections/skills/SkillEditorModal';
import { ChatHeaderRow } from './ChatHeaderRow';
import { HeaderMenuDropdown } from './headerMenu/HeaderMenuDropdown';
import { HeaderMoreMenu } from './headerMenu/HeaderMoreMenu';

interface FileHeaderBarProps {
  filePath: string;
  fileContent: string | null;
  /** The parsed conversation; `null` for a file that is not one. */
  conversation: ConversationDoc | null;
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

/**
 * The open file's top row: only ⋮. The conversation's H1 is the reading column's own heading,
 * renamed there (`ConversationTitle`), so the row does not repeat it.
 */
export const FileHeaderBar: React.FC<FileHeaderBarProps> = ({
  filePath,
  fileContent,
  conversation,
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
}) => {
  // "Save as skill…" opens the skill editor here, over the conversation, with the draft starting at once.
  const [skillTarget, setSkillTarget] = useState<SkillEditTarget | null>(null);
  const canSaveAsSkill = (conversation?.turns.length ?? 0) > 0;
  return (
  <ChatHeaderRow>
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
            {...(canSaveAsSkill ? { onSaveAsSkill: () => setSkillTarget({ kind: 'conversation', path: filePath }) } : {})}
            translateMenu={translateMenu}
            translateMenuLabel={translateMenuLabel}
            onClose={onCloseViewMenu}
          />
        </HeaderMoreMenu>
      </Box>
    </Group>
    <SkillEditorModal target={skillTarget} onClose={() => setSkillTarget(null)} t={t} />
  </ChatHeaderRow>
  );
};
