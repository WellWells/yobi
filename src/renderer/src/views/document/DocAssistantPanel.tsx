import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowUp, MessageSquarePlus, PanelRightClose, Quote, Sparkles, Square, X } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { AppTextarea } from '../../components/AppTextarea';
import { PanelToolbar, ToolbarIconButton } from '../../components/PanelToolbar';
import { ModelDropdown } from '../../components/chat/ModelDropdown';
import { ensureWritingModel } from '../../components/chat/writingToolsActions';
import { Z_POPOVER } from '../../config/zLayers';
import { threadOf, useDocAssistantStore, type AssistantEditCard } from '../../store/docAssistantStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { AssistantReply } from './AssistantReply';
import {
  ASSISTANT_MAX_ATTEMPTS, applyAssistantEdits, cancelAssistant, highlightEdit, revealEdit, revertAssistantEdits, sendAssistantMessage,
  skipAssistantEdits, subscribeAssistantProgress,
} from './docAssistantActions';

interface DocAssistantPanelProps {
  path: string;
  /** The document's scroll area, to show where an edit goes. */
  contentAreaRef: React.RefObject<HTMLDivElement | null>;
  /** Why edits cannot be applied right now; null when they can. */
  applyBlocked: string | null;
  t: (key: string) => string;
}

const SUGGESTIONS = ['notion.assistant.suggest.proofread', 'notion.assistant.suggest.summary', 'notion.assistant.suggest.tidy'] as const;

/** Dragging the panel's left edge: wider to the left. */
function useResize(): (event: React.PointerEvent<HTMLElement>) => void {
  const setWidth = useDocAssistantStore((s) => s.setWidth);
  return useCallback((event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useDocAssistantStore.getState().width;
    const onMove = (move: PointerEvent): void => setWidth(startWidth + startX - move.clientX);
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [setWidth]);
}

/**
 * The writing assistant beside a Notion document, the way an editor keeps its agent on the right:
 * the conversation about this document on top, what to do typed at the bottom. Replies answer,
 * ask, or make edits, which go into the local document at once (each one listed to find or undo);
 * Notion changes only when the user syncs.
 */
export const DocAssistantPanel: React.FC<DocAssistantPanelProps> = ({ path, contentAreaRef, applyBlocked, t }) => {
  const thread = useDocAssistantStore((s) => threadOf(s.threads, path));
  const width = useDocAssistantStore((s) => s.width);
  const setOpen = useDocAssistantStore((s) => s.setOpen);
  const clear = useDocAssistantStore((s) => s.clear);
  const patch = useDocAssistantStore((s) => s.patch);
  const modelUrl = useWritingToolsStore((s) => s.modelUrl);
  const chooseModel = useWritingToolsStore((s) => s.chooseModel);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startResize = useResize();
  const { messages, job, error, selection } = thread;

  useEffect(() => subscribeAssistantProgress(), []);
  useEffect(() => {
    void ensureWritingModel();
  }, []);
  // A passage handed over from the page: the box is where the user goes next.
  useEffect(() => {
    if (selection) inputRef.current?.focus();
  }, [selection]);
  // The newest turn in view, as in a chat.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, job?.phase]);

  const send = useCallback((text: string): void => {
    if (!text.trim() || job) return;
    setDraft('');
    void sendAssistantMessage(path, text);
  }, [job, path]);

  const reveal = useCallback((edit: AssistantEditCard): void => {
    revealEdit(contentAreaRef.current, edit);
  }, [contentAreaRef]);
  const hover = useCallback((edit: AssistantEditCard | null): void => {
    highlightEdit(contentAreaRef.current, edit);
  }, [contentAreaRef]);
  // A row taken away under the pointer (new conversation, panel closed) never says the pointer left.
  useEffect(() => () => highlightEdit(null, null), []);

  const phaseText = job
    ? job.phase === 'waiting'
      ? t('notion.assistant.phase.waiting')
      : job.phase === 'retrying'
        ? t('notion.assistant.phase.retrying').replace('{{attempt}}', String(job.attempt)).replace('{{max}}', String(ASSISTANT_MAX_ATTEMPTS))
        : t('notion.assistant.phase.running')
    : '';

  return (
    <Box
      w={width}
      pos="relative"
      data-selection-ignore
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', minHeight: 0 }}
    >
      {/* The edge to drag; wide enough to grab, drawn as the border. */}
      <Box
        pos="absolute"
        top={0}
        bottom={0}
        left={-3}
        w={6}
        style={{ cursor: 'col-resize', zIndex: 1 }}
        onPointerDown={startResize}
        aria-hidden
      />
      <PanelToolbar>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Sparkles size={15} color="var(--text-secondary)" />
          <Text fz="var(--font-size-sm)" fw={600} truncate>{t('notion.assistant.title')}</Text>
        </Group>
        <Group gap={2} wrap="nowrap">
          {modelUrl && (
            <ModelDropdown value={modelUrl} onChange={chooseModel} menuDirection="down" zIndex={Z_POPOVER} tooltipLabel={t('notion.assistant.model')} />
          )}
          <ToolbarIconButton
            icon={MessageSquarePlus}
            label={t('notion.assistant.newChat')}
            disabled={messages.length === 0 && !error}
            onClick={() => {
              if (job) cancelAssistant(path);
              clear(path);
            }}
          />
          <ToolbarIconButton icon={PanelRightClose} label={t('notion.assistant.close')} onClick={() => setOpen(false)} />
        </Group>
      </PanelToolbar>

      <Box ref={listRef} flex={1} px={14} py={12} style={{ overflowY: 'auto', minHeight: 0 }}>
        {messages.length === 0 && !job && !error ? (
          <Stack gap={10}>
            <Text fz="var(--font-size-sm)" fw={600}>{t('notion.assistant.empty.title')}</Text>
            <Text fz="var(--font-size-xs)" c="var(--text-muted)" style={{ lineHeight: 1.6 }}>{t('notion.assistant.empty.body')}</Text>
            <Stack gap={6} align="flex-start">
              {SUGGESTIONS.map((key) => (
                <AppButton key={key} size="compact-sm" variant="default" onClick={() => send(t(key))} style={{ maxWidth: '100%' }}>
                  <Text fz="var(--font-size-xs)" truncate>{t(key)}</Text>
                </AppButton>
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack gap={16}>
            {messages.map((message) => (message.role === 'user' ? (
              <Stack key={message.id} gap={4} align="flex-end">
                {message.quote && (
                  <Group gap={4} wrap="nowrap" maw="90%">
                    <Quote size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate>{message.quote}</Text>
                  </Group>
                )}
                <Box
                  px={12}
                  py={8}
                  maw="90%"
                  style={{ background: 'var(--bg-hover)', borderRadius: 'var(--mantine-radius-lg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  <Text fz="var(--font-size-sm)">{message.text}</Text>
                </Box>
              </Stack>
            ) : (
              <AssistantReply
                key={message.id}
                message={message}
                applyBlocked={applyBlocked}
                canAnswer={!job}
                onApply={(ids) => { void applyAssistantEdits(path, message.id, ids); }}
                onSkip={(ids) => skipAssistantEdits(path, message.id, ids)}
                onRevert={(ids) => { void revertAssistantEdits(path, message.id, ids); }}
                onHover={hover}
                onReveal={reveal}
                onAnswer={send}
                t={t}
              />
            )))}
            {job && (
              <Group gap={8} wrap="nowrap">
                <Loader size={14} />
                <Text fz="var(--font-size-xs)" c="var(--text-muted)">{phaseText}</Text>
              </Group>
            )}
            {error && (
              <Alert color="var(--mantine-color-error)" variant="light" p={10}>
                <Group justify="space-between" gap={8} wrap="nowrap">
                  <Text fz="var(--font-size-xs)">{error.message}</Text>
                  <AppButton
                    size="compact-sm"
                    variant="subtle"
                    onClick={() => {
                      patch(path, { error: null });
                      send(error.retry);
                    }}
                  >
                    {t('notion.assistant.retry')}
                  </AppButton>
                </Group>
              </Alert>
            )}
          </Stack>
        )}
      </Box>

      <Box px={12} pt={8} pb={12} style={{ borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        {selection && (
          <Group gap={6} wrap="nowrap" mb={6} px={8} py={4} style={{ background: 'var(--bg-hover)', borderRadius: 'var(--mantine-radius-sm)' }}>
            <Quote size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <Text fz="var(--font-size-xs)" c="var(--text-secondary)" truncate style={{ flex: 1, minWidth: 0 }}>{selection.text}</Text>
            <ActionIcon variant="subtle" size="xs" c="dimmed" aria-label={t('notion.assistant.selection.remove')} onClick={() => patch(path, { selection: null })}>
              <X size={12} />
            </ActionIcon>
          </Group>
        )}
        <Group gap={6} wrap="nowrap" align="flex-end">
          <AppTextarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={t(selection ? 'notion.assistant.placeholderSelection' : 'notion.assistant.placeholder')}
            autosize
            minRows={2}
            maxRows={8}
            style={{ flex: 1 }}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter is a new line; Enter that ends an IME composition is neither.
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send(draft);
            }}
          />
          {job ? (
            <Tooltip label={t('notion.assistant.stop')} position="top">
              <ActionIcon size={32} variant="default" aria-label={t('notion.assistant.stop')} onClick={() => cancelAssistant(path)}>
                <Square size={13} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label={t('notion.assistant.send')} position="top">
              <ActionIcon size={32} variant="filled" aria-label={t('notion.assistant.send')} disabled={!draft.trim()} onClick={() => send(draft)}>
                <ArrowUp size={15} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>
    </Box>
  );
};
