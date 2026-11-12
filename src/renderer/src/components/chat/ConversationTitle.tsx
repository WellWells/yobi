import React from 'react';
import { ActionIcon, Flex, Text, Tooltip } from '@mantine/core';
import { Pencil } from 'lucide-react';
import { RenameInput } from '../RenameInput';
import { READING_FACE } from '../../styles/readingText';
import type { HeaderTitleEditProps } from './HeaderTitleField';
import classes from './ConversationTitle.module.css';

const TITLE_SIZE = 'var(--font-size-3xl)';
const TITLE_LINE_HEIGHT = 1.4;
/** One line of the title: the pencil is centred on the first line however many lines it wraps to. */
const TITLE_LINE = `calc(${TITLE_SIZE} * ${TITLE_LINE_HEIGHT})`;
/** The field's own border and side padding, pulled back so its text sits where the H1's did. */
const FIELD_PAD_X = 8;

interface ConversationTitleProps {
  title: string;
  /** The open file's H1 edit; absent where there is no file to write (the temporary chat). */
  edit?: HeaderTitleEditProps;
  t: (key: string) => string;
}

/**
 * The conversation's H1 at the top of the reading column, which is also where it is renamed: the
 * pencil beside it edits that H1 in place, the same action and wording as the sidebar's "Edit H1
 * title". The window's top row does not repeat the title.
 */
export const ConversationTitle: React.FC<ConversationTitleProps> = ({ title, edit, t }) => {
  if (edit?.titleEditing) {
    return (
      <RenameInput
        ref={edit.titleInputRef}
        value={edit.titleEditValue}
        onChange={edit.setTitleEditValue}
        ai={edit.aiSource}
        commitOnBlur
        onCommit={edit.onCommitTitleEdit}
        onCancel={edit.onCancelTitleEdit}
        aria-label={t('context.editH1')}
        styles={{
          wrapper: { margin: `-1px -${FIELD_PAD_X + 1}px` },
          input: {
            fontFamily: READING_FACE,
            fontSize: TITLE_SIZE,
            fontWeight: 700,
            lineHeight: TITLE_LINE_HEIGHT,
            height: 'auto',
            minHeight: 0,
            paddingBlock: 0,
            // The end side is Mantine's: it leaves room for the ✨ at the end of the box.
            paddingInlineStart: FIELD_PAD_X,
          },
        }}
      />
    );
  }
  return (
    <Flex className={classes.title} gap={6} align="flex-start">
      <Text
        component="h1"
        data-find-scope
        ff={READING_FACE}
        fz={TITLE_SIZE}
        fw={700}
        c="var(--text-primary)"
        lh={TITLE_LINE_HEIGHT}
        style={{ minWidth: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {title}
      </Text>
      {edit && (
        <Flex className={classes.edit} h={TITLE_LINE} align="center" style={{ flexShrink: 0 }}>
          <Tooltip label={t('context.editH1')} position="bottom">
            <ActionIcon
              onClick={edit.onStartTitleEdit}
              aria-label={t('context.editH1')}
              variant="subtle"
              size="sm"
              c="dimmed"
            >
              <Pencil size={14} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      )}
    </Flex>
  );
};
