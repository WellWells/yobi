import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Group, Loader, Stack, Text } from '@mantine/core';
import { MessageSquarePlus, PanelRightClose, Quote, Sparkles, X } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { ASSISTANT_TEXT, AssistantComposer, AssistantSuggestions } from '../../components/AssistantPanel';
import { PanelToolbar, ToolbarIconButton } from '../../components/PanelToolbar';
import { ensureWritingModel } from '../../components/chat/writingToolsActions';
import { threadOf, useDocAssistantStore, type AssistantEditCard } from '../../store/docAssistantStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { useNarrowCaptionPane } from '../../store/captionStore';
import { AssistantReply } from './AssistantReply';
import {
  ASSISTANT_MAX_ATTEMPTS, applyAssistantEdits, cancelAssistant, highlightEdit, revealEdit, revertAssistantEdits, sendAssistantMessage,
  skipAssistantEdits, subscribeAssistantProgress,
} from './docAssistantActions';
import { fillTemplate } from '../../../../shared/fillTemplate';

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
  // The panel holds the window's right edge beside a document: the caption controls over its
  // first row keep to their icons.
  useNarrowCaptionPane('chat');
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
  // A click in the sidebar opened this document: the box is the document view's composer.
  const focusRequested = useDocAssistantStore((s) => s.focusRequested);
  const consumeFocusRequest = useDocAssistantStore((s) => s.consumeFocusRequest);
  useEffect(() => {
    if (!focusRequested) return;
    inputRef.current?.focus();
    consumeFocusRequest();
  }, [focusRequested, consumeFocusRequest]);
  // The newest turn in view, as in a chat.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, job?.phase]);

  const send = useCallback((text: string): void => {
    if (!text.trim() || job || !modelUrl) return;
    setDraft('');
    void sendAssistantMessage(path, text);
  }, [job, modelUrl, path]);

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
        ? fillTemplate(t('notion.assistant.phase.retrying'), { attempt: String(job.attempt), max: String(ASSISTANT_MAX_ATTEMPTS) })
        : t('notion.assistant.phase.running')
    : '';

  return (
    <Box
      // A complementary landmark and an F6 region (WCAG 1.3.1, 2.4.1); F6 lands in its text box.
      component="aside"
      aria-label={t('notion.assistant.title')}
      data-region="panel"
      data-region-focus="textarea"
      w={width}
      pos="relative"
      data-doc-assistant=""
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
      {/* The panel ends at the window's right edge, so its top row is the title bar there, with the
          caption controls floating at its end: room for the panel's name only. Its controls take
          the row under it. */}
      <PanelToolbar caption="right" withBottomBorder={false}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Sparkles size={15} color="var(--text-secondary)" />
          <Text fz={ASSISTANT_TEXT.heading} fw={600} truncate>{t('notion.assistant.title')}</Text>
        </Group>
      </PanelToolbar>
      <PanelToolbar justify="flex-end">
        <Group gap={2} wrap="nowrap">
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

      <Box ref={listRef} flex={1} px={10} py={10} style={{ overflowY: 'auto', minHeight: 0 }}>
        {messages.length === 0 && !job && !error ? (
          <Stack gap={8}>
            <Text fz={ASSISTANT_TEXT.heading} fw={600}>{t('notion.assistant.empty.title')}</Text>
            <Text fz={ASSISTANT_TEXT.body} c="var(--text-muted)" style={{ lineHeight: 1.6 }}>{t('notion.assistant.empty.body')}</Text>
            <AssistantSuggestions suggestions={SUGGESTIONS.map((key) => t(key))} onSelect={setDraft} disabled={!modelUrl} />
          </Stack>
        ) : (
          <Stack gap={16}>
            {messages.map((message) => (message.role === 'user' ? (
              <Stack key={message.id} gap={4} align="flex-end">
                {message.quote && (
                  <Group gap={4} wrap="nowrap" maw="90%">
                    <Quote size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)" truncate>{message.quote}</Text>
                  </Group>
                )}
                <Box
                  px={12}
                  py={8}
                  maw="90%"
                  style={{ background: 'var(--bg-hover)', borderRadius: 'var(--mantine-radius-lg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  <Text fz={ASSISTANT_TEXT.body}>{message.text}</Text>
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
                <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-muted)">{phaseText}</Text>
              </Group>
            )}
            {error && (
              <Alert color="var(--mantine-color-error)" variant="light" p={10}>
                <Group justify="space-between" gap={8} wrap="nowrap">
                  <Text fz={ASSISTANT_TEXT.body}>{error.message}</Text>
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

      <AssistantComposer
        inputRef={inputRef}
        value={draft}
        onChange={setDraft}
        onSend={() => send(draft)}
        onStop={() => cancelAssistant(path)}
        running={Boolean(job)}
        modelUrl={modelUrl}
        onModelChange={chooseModel}
        placeholder={t(selection ? 'notion.assistant.placeholderSelection' : 'notion.assistant.placeholder')}
        modelLabel={t('notion.assistant.model')}
        sendLabel={t('notion.assistant.send')}
        stopLabel={t('notion.assistant.stop')}
      >
        {selection && (
          <Group gap={6} wrap="nowrap" mb={6} px={8} py={4} style={{ background: 'var(--bg-hover)', borderRadius: 'var(--mantine-radius-sm)' }}>
            <Quote size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <Text fz={ASSISTANT_TEXT.secondary} c="var(--text-secondary)" truncate style={{ flex: 1, minWidth: 0 }}>{selection.text}</Text>
            <ActionIcon variant="subtle" size="xs" c="dimmed" aria-label={t('notion.assistant.selection.remove')} onClick={() => patch(path, { selection: null })}>
              <X size={12} />
            </ActionIcon>
          </Group>
        )}
      </AssistantComposer>
    </Box>
  );
};
