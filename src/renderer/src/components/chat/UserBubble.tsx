import React, { useCallback, useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Copy, Pencil } from 'lucide-react';
import { readTurnAttachments } from '../../../../shared/conversationDoc';
import { clipboardApi } from '../../api/electronApi';
import { matchesShortcut } from '../../store/shortcutStore';
import { isComposingKey } from '../../utils/imeKeys';
import { AppButton } from '../AppButton';
import { AppTextarea } from '../AppTextarea';
import { CollapsibleContent } from './CollapsibleContent';
import { PromptBody } from './PromptBody';
import { TurnAttachments } from './TurnAttachments';
import styles from './UserBubble.module.css';

/** An edited question going out: the turn it replaces, what it said, and what it says now. */
export interface PromptEditSubmit {
  turnIndex: number;
  /** The question as shown when the edit began; main checks the file still has it. */
  original: string;
  text: string;
  /** The question's own attachments, sent again with it. */
  attachments: string[];
}

interface UserBubbleProps {
  prompt: string;
  t: (key: string) => string;
  attachments?: string[];
  /** Where each of them is on this computer, in the same order (`af`). */
  attachmentFiles?: string[];
  turnIndex?: number;
  /** Sends the edited question; resolves false when nothing went out, so the editor stays open. */
  onEditPrompt?: (edit: PromptEditSubmit) => Promise<boolean>;
  /** Why the question cannot be edited right now (an answer is still coming, a question waits). */
  editBlockedReason?: string | null;
  /** Side by side: the question sits in its own column, with no bubble around it. */
  bare?: boolean;
}

const COPIED_MS = 1_600;

/** The editor opens with the caret after the question, ready to add to it (a ref callback runs once per mount). */
function placeCaretAtEnd(field: HTMLTextAreaElement | null): void {
  if (!field) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
}

export const UserBubble = React.memo<UserBubbleProps>(({
  prompt, t, attachments, attachmentFiles, turnIndex, onEditPrompt, editBlockedReason = null, bare = false,
}) => {
  const attached = useMemo(
    () => readTurnAttachments({ a: attachments, af: attachmentFiles }),
    [attachments, attachmentFiles],
  );
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const editable = Boolean(onEditPrompt) && turnIndex !== undefined;

  const handleCopy = useCallback((): void => {
    void clipboardApi.copyText(prompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    });
  }, [prompt]);

  const cancelEdit = useCallback((): void => {
    if (!sending) setDraft(null);
  }, [sending]);

  const submitEdit = useCallback((): void => {
    const text = draft?.trim() ?? '';
    if (!text || sending || !onEditPrompt || turnIndex === undefined || editBlockedReason !== null) return;
    setSending(true);
    const files = attached.flatMap((item) => (item.path ? [item.path] : []));
    void onEditPrompt({ turnIndex, original: prompt, text, attachments: files })
      .then((sent) => { if (sent) setDraft(null); })
      .finally(() => setSending(false));
  }, [draft, sending, onEditPrompt, turnIndex, editBlockedReason, attached, prompt]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    if (matchesShortcut(event, 'promptEditor.send')) {
      event.preventDefault();
      submitEdit();
    } else if (matchesShortcut(event, 'promptEditor.cancel')) {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  }, [submitEdit, cancelEdit]);

  if (draft !== null) {
    return (
      <Stack
        gap={10}
        w="100%"
        bg="var(--bg-secondary)"
        px={16}
        py={12}
        style={{ borderRadius: 'var(--mantine-radius-lg)', border: '1px solid var(--border)' }}
      >
        {attached.length > 0 && <TurnAttachments attachments={attached} />}
        <AppTextarea
          tone="body"
          autosize
          minRows={1}
          maxRows={14}
          value={draft}
          disabled={sending}
          aria-label={t('chat.promptEdit.title')}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          ref={placeCaretAtEnd}
          styles={{ input: { fontSize: 'var(--font-size-md)', lineHeight: 1.7 } }}
        />
        <Group gap={8} justify="space-between" wrap="nowrap" align="center">
          <Text fz="var(--font-size-xs)" c="var(--text-muted)">
            {editBlockedReason ?? t('chat.promptEdit.hint')}
          </Text>
          <Group gap={8} wrap="nowrap">
            <AppButton variant="default" size="compact-sm" onClick={cancelEdit} disabled={sending}>
              {t('chat.edit.cancel')}
            </AppButton>
            <AppButton
              size="compact-sm"
              onClick={submitEdit}
              loading={sending}
              disabled={!draft.trim() || editBlockedReason !== null}
            >
              {t('chat.promptEdit.send')}
            </AppButton>
          </Group>
        </Group>
      </Stack>
    );
  }

  const body = (
    <Stack gap={8}>
      {attached.length > 0 && <TurnAttachments attachments={attached} />}
      {bare
        ? <Box data-find-scope><PromptBody prompt={prompt} fw={500} /></Box>
        : (
          <CollapsibleContent fadeColor="var(--bg-secondary)" t={t}>
            <Box data-find-scope><PromptBody prompt={prompt} /></Box>
          </CollapsibleContent>
        )}
    </Stack>
  );

  return (
    <Stack gap={4} align={bare ? 'stretch' : 'flex-end'} className={styles.question}>
      {bare ? body : (
        <Box
          maw="80%"
          bg="var(--bg-secondary)"
          px={16}
          py={10}
          style={{
            borderRadius: 'var(--mantine-radius-lg)',
            border: '1px solid var(--border)',
          }}
        >
          {body}
        </Box>
      )}
      <Group
        gap={4}
        justify={bare ? 'flex-start' : 'flex-end'}
        className={styles.actions}
        data-copied={copied || undefined}
        data-find-omit
      >
        <Tooltip label={copied ? t('chat.copied') : t('chat.promptEdit.copy')} position="bottom">
          <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.promptEdit.copy')} onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionIcon>
        </Tooltip>
        {editable && (
          <Tooltip label={editBlockedReason ?? t('chat.promptEdit.action')} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('chat.promptEdit.action')}
              // data-disabled, not disabled: a disabled button gets no pointer events, so the tooltip saying why would never show.
              data-disabled={editBlockedReason !== null || undefined}
              onClick={() => { if (editBlockedReason === null) setDraft(prompt); }}
            >
              <Pencil size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </Stack>
  );
});

UserBubble.displayName = 'UserBubble';
