import React from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { FileText, Pencil, type LucideIcon } from 'lucide-react';
import { AppTextInput } from '../AppTextInput';

export interface HeaderTitleEditProps {
  title: string;
  titleEditing: boolean;
  titleEditValue: string;
  setTitleEditValue: (value: string) => void;
  onCommitTitleEdit: () => void;
  onCancelTitleEdit: () => void;
  onStartTitleEdit: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * The header's title: the file's H1 with the pencil that edits it, or the field while editing.
 * Conversations and Notion documents share it, so the gesture is the same everywhere.
 */
export const HeaderTitleField: React.FC<HeaderTitleEditProps & {
  t: (key: string) => string;
  /** A lucide icon, or a brand mark (the Notion document's). */
  icon?: LucideIcon | React.ComponentType<{ size?: number }>;
  /** Next to the title, before the pencil (the document's sync state). */
  extra?: React.ReactNode;
}> = ({
  title, titleEditing, titleEditValue, setTitleEditValue, onCommitTitleEdit, onCancelTitleEdit, onStartTitleEdit,
  titleInputRef, t, icon: Icon = FileText, extra,
}) => (titleEditing ? (
  <AppTextInput
    ref={titleInputRef}
    value={titleEditValue}
    onChange={(event) => setTitleEditValue(event.target.value)}
    onBlur={onCommitTitleEdit}
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onCommitTitleEdit();
      }
      if (event.key === 'Escape') {
        onCancelTitleEdit();
      }
    }}
    aria-label={t('context.editH1')}
    variant="default"
    size="xs"
    fw={600}
    style={{ flex: 1, minWidth: 0 }}
  />
) : (
  // With a status beside it the row stays one line: the title gives way, not the header's height.
  <Group gap={8} flex={1} wrap={extra ? 'nowrap' : undefined} style={{ minWidth: 0 }}>
    <Group gap={6} wrap={extra ? 'nowrap' : undefined} style={{ minWidth: 0, overflow: 'hidden' }}>
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
