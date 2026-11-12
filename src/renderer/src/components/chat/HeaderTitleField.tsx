import React from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { FileText, Pencil, type LucideIcon } from 'lucide-react';
import type { AiNameSource } from '../../../../shared/aiName';
import { RenameInput } from '../RenameInput';

export interface HeaderTitleEditProps {
  title: string;
  titleEditing: boolean;
  titleEditValue: string;
  setTitleEditValue: (value: string) => void;
  onCommitTitleEdit: () => void;
  onCancelTitleEdit: () => void;
  onStartTitleEdit: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  /** What the rename box's ✨ names it from (the open file). */
  aiSource: AiNameSource | null;
}

/**
 * A Notion document's header title: the page's H1 with the pencil that edits it, or the field while
 * editing. The document's page draws no H1, so its header is where the title is; a conversation's is
 * the reading column's own heading (`ConversationTitle`), with the same pencil and wording.
 */
export const HeaderTitleField: React.FC<HeaderTitleEditProps & {
  t: (key: string) => string;
  /** A lucide icon, or a brand mark (the Notion document's). */
  icon?: LucideIcon | React.ComponentType<{ size?: number }>;
  /** Next to the title, before the pencil (the document's sync state). */
  extra?: React.ReactNode;
}> = ({
  title, titleEditing, titleEditValue, setTitleEditValue, onCommitTitleEdit, onCancelTitleEdit, onStartTitleEdit,
  titleInputRef, aiSource, t, icon: Icon = FileText, extra,
}) => (titleEditing ? (
  <RenameInput
    ref={titleInputRef}
    value={titleEditValue}
    onChange={setTitleEditValue}
    ai={aiSource}
    commitOnBlur
    onCommit={onCommitTitleEdit}
    onCancel={onCancelTitleEdit}
    aria-label={t('context.editH1')}
    variant="default"
    size="xs"
    fw={600}
    style={{ flex: 1, minWidth: 0 }}
  />
) : (
  // The row stays one line, a status beside it or a narrow window: the title gives way (an
  // ellipsis), not the header's height — the pencil never drops under it.
  <Group gap={8} flex={1} wrap="nowrap" style={{ minWidth: 0 }}>
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0, overflow: 'hidden' }}>
      <Icon size={13} />
      <Text
        fz="var(--font-size-base)"
        c="var(--mantine-color-text)"
        fw={600}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, cursor: 'default' }}
      >{title}</Text>
    </Group>
    {/* Same action and wording as the sidebar's "Edit H1 title": the header shows that H1. */}
    <Tooltip label={t('context.editH1')} position="bottom">
      <ActionIcon
        onClick={onStartTitleEdit}
        aria-label={t('context.editH1')}
        variant="subtle"
        size="sm"
        c="dimmed"
      >
        <Pencil size={13} />
      </ActionIcon>
    </Tooltip>
    {extra}
  </Group>
));
