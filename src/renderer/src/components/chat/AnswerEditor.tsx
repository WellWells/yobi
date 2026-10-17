import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Box, Group, Text, Tooltip } from '@mantine/core';
import { Info, PencilLine, TriangleAlert } from 'lucide-react';
import { AppButton } from '../AppButton';
import { AppSegmentedControl } from '../AppSegmentedControl';
import { AppTextarea } from '../AppTextarea';
import { WebDialog } from '../WebDialog';
import { BlockEditor } from './BlockEditor';
import { saveAnswerDraft } from './answerEditActions';
import { releaseFollow } from '../../hooks/useStickToBottom';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { matchesShortcut, useResolvedCombo } from '../../store/shortcutStore';
import { comboLabel } from '../../../../shared/shortcuts';
import { isMac } from '../../utils/keyLabels';

interface AnswerEditorProps {
  path: string;
  turnIndex: number;
  /** The answer the file has now; differs from the draft's base after a conflict. */
  response: string;
  turnCount: number;
  editedAt: string | null;
  /** A reply is on its way into this conversation; saving now would race it. */
  locked: boolean;
  t: (key: string) => string;
  /** A Notion document's body rather than an answer. */
  notion?: boolean;
  /** Where Cancel and Save go instead of the card's foot (the document view's header). */
  actionsTarget?: HTMLElement | null;
}

/** Where the editor's top lands when it opens out of view: clear of the header, not under it. */
const REVEAL_MARGIN_PX = 80;

type EditorMode = 'blocks' | 'source';
const EDITOR_MODE_KEY = 'yobi.answerEditor.mode';

/** Paragraph mode unless the user last chose the Markdown source. */
function loadEditorMode(): EditorMode {
  try {
    return window.localStorage.getItem(EDITOR_MODE_KEY) === 'source' ? 'source' : 'blocks';
  } catch {
    return 'blocks';
  }
}

function saveEditorMode(mode: EditorMode): void {
  try {
    window.localStorage.setItem(EDITOR_MODE_KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts for this editor only.
  }
}

export const AnswerEditor: React.FC<AnswerEditorProps> = ({
  path, turnIndex, response, turnCount, editedAt, locked, t, notion = false, actionsTarget = null,
}) => {
  const draft = useAnswerEditStore((s) => s.drafts[draftKey(path, turnIndex)]);
  const update = useAnswerEditStore((s) => s.update);
  const discard = useAnswerEditStore((s) => s.discard);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const saveKeys = comboLabel(useResolvedCombo('answerEditor.save'), isMac);

  // A Notion document always opens paragraph by paragraph, as it reads: its source is Notion's own
  // Markdown with tags, which the conversations' remembered "source" choice should not bring up.
  const [mode, setMode] = useState<EditorMode>(() => (notion ? 'blocks' : loadEditorMode()));
  const changeMode = useCallback((next: EditorMode): void => {
    setMode(next);
    if (!notion) saveEditorMode(next);
  }, [notion]);
  const consumeFocus = useCallback((): void => update(path, turnIndex, { focus: undefined }), [update, path, turnIndex]);

  // In source mode the caret goes straight to where the selection began; paragraph mode opens that block itself.
  const focusOffset = draft?.focus;
  useEffect(() => {
    if (mode !== 'source' || focusOffset === undefined) return;
    const area = inputRef.current;
    if (area) {
      area.focus({ preventScroll: true });
      area.setSelectionRange(focusOffset, focusOffset);
    }
    consumeFocus();
  }, [mode, focusOffset, consumeFocus]);

  // Opening the editor hands the scroll position to the user, and brings the editor's top into view.
  useEffect(() => {
    const card = cardRef.current;
    releaseFollow(card);
    // Focus inside the card, so Ctrl+S and Esc reach it even before a paragraph is opened.
    (inputRef.current ?? card)?.focus({ preventScroll: true });
    if (!card) return;
    const top = card.getBoundingClientRect().top;
    if (top < REVEAL_MARGIN_PX || top > window.innerHeight - REVEAL_MARGIN_PX) {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, []);

  const save = useCallback((overwrite?: string): void => {
    if (locked) return;
    void saveAnswerDraft({ path, turnIndex, turnCount, editedAt, ...(overwrite === undefined ? {} : { overwrite }) });
  }, [locked, path, turnIndex, turnCount, editedAt]);

  const requestCancel = useCallback((): void => {
    const current = useAnswerEditStore.getState().drafts[draftKey(path, turnIndex)];
    if (current && current.text !== current.base) setConfirmDiscard(true);
    else discard(path, turnIndex);
  }, [discard, path, turnIndex]);

  const loadLatest = useCallback((): void => {
    update(path, turnIndex, { text: response, base: response, conflict: false });
  }, [update, path, turnIndex, response]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return;
    if (matchesShortcut(event, 'answerEditor.save')) {
      event.preventDefault();
      event.stopPropagation();
      save();
    } else if (matchesShortcut(event, 'answerEditor.cancel')) {
      event.preventDefault();
      event.stopPropagation();
      requestCancel();
    }
  }, [save, requestCancel]);

  if (!draft) return null;
  const empty = !draft.text.trim();
  const unchanged = draft.text === draft.base;
  const actions = (
    <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
      <AppButton size="compact-sm" variant="default" onClick={requestCancel}>
        {t('chat.edit.cancel')}
      </AppButton>
      <Tooltip
        label={locked ? t('chat.edit.lockedSending') : t('chat.edit.saveTooltip').replace('{{shortcut}}', saveKeys)}
        position="bottom"
      >
        <AppButton
          size="compact-sm"
          loading={draft.saving}
          disabled={locked || empty || unchanged || draft.conflict}
          onClick={() => save()}
        >
          {t('chat.edit.save')}
        </AppButton>
      </Tooltip>
    </Group>
  );

  return (
    <Box
      ref={cardRef}
      tabIndex={-1}
      data-selection-ignore
      onKeyDown={handleKeyDown}
      style={{
        outline: 'none',
        border: '1px solid var(--border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--bg-secondary)',
        scrollMarginTop: REVEAL_MARGIN_PX,
      }}
    >
      <Group justify="space-between" gap={8} px={12} py={8} style={{ borderBottom: '1px solid var(--border)' }}>
        <Group gap={6}>
          <PencilLine size={14} color="var(--text-muted)" />
          <Text fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)">{t(notion ? 'notion.edit.title' : 'chat.edit.title')}</Text>
        </Group>
        <AppSegmentedControl
          size="xs"
          fullWidth={false}
          value={mode}
          options={[
            { value: 'blocks', label: t('chat.edit.mode.blocks') },
            { value: 'source', label: t('chat.edit.mode.source') },
          ]}
          onChange={(value) => changeMode(value === 'source' ? 'source' : 'blocks')}
        />
      </Group>

      <Box p={12}>
        {mode === 'blocks' ? (
          <BlockEditor
            path={path}
            turnIndex={turnIndex}
            text={draft.text}
            onChange={(text) => update(path, turnIndex, { text })}
            {...(draft.focus === undefined ? {} : { focus: draft.focus })}
            onFocusConsumed={consumeFocus}
            t={t}
            notion={notion}
          />
        ) : (
          <AppTextarea
            ref={inputRef}
            tone="body"
            autosize
            minRows={6}
            value={draft.text}
            aria-label={t(notion ? 'notion.edit.title' : 'chat.edit.title')}
            onChange={(event) => update(path, turnIndex, { text: event.currentTarget.value })}
            styles={{ input: { fontSize: 'var(--font-size-md)', lineHeight: 1.7 } }}
          />
        )}
      </Box>

      {draft.conflict && (
        <Box px={12} pb={12}>
          <Alert
            color="var(--mantine-color-warning)"
            variant="light"
            icon={<TriangleAlert size={16} />}
            title={t('chat.edit.conflict.title')}
          >
            <Text fz="var(--font-size-sm)" mb={8}>{t('chat.edit.conflict.body')}</Text>
            <Group gap={8}>
              <AppButton size="compact-sm" variant="default" onClick={loadLatest}>
                {t('chat.edit.conflict.useFile')}
              </AppButton>
              <AppButton size="compact-sm" variant="light" disabled={locked || empty} onClick={() => save(response)}>
                {t('chat.edit.conflict.keepMine')}
              </AppButton>
            </Group>
          </Alert>
        </Box>
      )}

      <Group justify="space-between" wrap="nowrap" gap={12} px={12} pb={12}>
        <Group gap={6} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
          <Box c="var(--text-muted)" style={{ flexShrink: 0, lineHeight: 0, paddingTop: 2 }}><Info size={14} /></Box>
          <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.5}>
            {empty
              ? t(notion ? 'notion.edit.emptyHint' : 'chat.edit.emptyHint')
              : t(notion ? 'notion.edit.hint' : 'chat.edit.hint')}
          </Text>
        </Group>
        {!actionsTarget && actions}
      </Group>
      {/* A document puts them in its header, where they stay in reach however long the page is. */}
      {actionsTarget && createPortal(actions, actionsTarget)}

      <WebDialog
        open={confirmDiscard}
        title={t('chat.edit.discard.title')}
        description={t('chat.edit.discard.body')}
        confirmText={t('chat.edit.discard.confirm')}
        cancelText={t('chat.edit.discard.keep')}
        danger
        onConfirm={() => { setConfirmDiscard(false); discard(path, turnIndex); }}
        onCancel={() => { setConfirmDiscard(false); (inputRef.current ?? cardRef.current)?.focus(); }}
      />
    </Box>
  );
};
