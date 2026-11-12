import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Group, Stack } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import type { CaptureFormat, CaptureTurn } from '../../../../shared/types';
import { sumTurnUsage } from '../../../../shared/tokenEstimate';
import { editedAt, unsentEditedTurns } from '../../../../shared/editedReplies';
import { NEW_CONVERSATION_KEY, useAppStore, type PendingTurn } from '../../store/appStore';
import { runHeldOpen, useAgentRunStore, type AgentChoicePick } from '../../store/useAgentRunStore';
import { useI18nStore } from '../../store/i18nStore';
import { useConversationMoves } from '../../store/conversationMoves';
import { movedPathFor } from '../../../../shared/conversationMove';
import { useFormatTime } from '../../hooks/useFormatTime';
import { scrollMoveFor, useStickToBottom, type ScrollSnapshot } from '../../hooks/useStickToBottom';
import { UserBubble, type PromptEditSubmit } from '../../components/chat/UserBubble';
import { AssistantTurn } from '../../components/chat/AssistantTurn';
import { PendingTurnBubble } from '../../components/chat/PendingTurnBubble';
import { ShellBubble } from '../../components/chat/ShellBubble';
import { parseShellTurnPrompt, readTurnShell } from '../../../../shared/shellBang';
import { TokenUsageLabel } from '../../components/chat/TokenUsageLabel';
import { ConversationTitle } from '../../components/chat/ConversationTitle';
import type { HeaderTitleEditProps } from '../../components/chat/HeaderTitleField';
import { readingMaxWidth, useReadingStore } from '../../store/readingStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

const MAX_WIDTH = 720;
const SIDE_QUESTION_WIDTH = '34%';
const SIDE_STICKY_TOP = 16;
const SIDE_MAX_WIDTH = 1160;

interface ConversationViewProps {
  conversation: ConversationDoc;
  conversationPath: string;
  onCaptureTurnAs?: (format: CaptureFormat, turn: CaptureTurn) => Promise<boolean>;
  /** Answers the agent's waiting question with a choice it offered. */
  onChooseAnswer?: (pick: AgentChoicePick) => void;
  /** Sends a flow button's command line, as if the user had typed it. */
  onTurnButton?: (commandLine: string) => void;
  /** "Analyze" under a forwarded X post: asks the agent about the post and its replies. */
  onAnalyzeXPost?: (link: string) => void;
  /** Renaming the open file's H1 from its title; absent for the temporary chat (no file). */
  titleEdit?: HeaderTitleEditProps;
  /** Sends an edited question in place of that turn and the ones after it; absent for the temporary chat. */
  onEditPrompt?: (edit: PromptEditSubmit) => Promise<boolean>;
}

function ConversationViewInner({ conversation, conversationPath, onCaptureTurnAs, onChooseAnswer, onTurnButton, onAnalyzeXPost, titleEdit, onEditPrompt }: ConversationViewProps) {
  const t = useI18nStore((s) => s.t);
  const formatTime = useFormatTime();
  const markdownZoom = useAppStore((state) => state.markdownZoom);
  const layoutMode = useAppStore((state) => state.layoutMode);
  const showTokenUsage = useAppStore((state) => state.showTokenUsage);
  // Full width lifts the cap; the side padding stays so text never touches the edge.
  const fullWidth = useReadingStore((state) => state.prefs.fullWidth);
  const pending = useAppStore(
    useShallow((state): PendingTurn[] => state.pendingTurns[conversationPath] ?? []),
  );
  const zoomStyle = markdownZoom === 100 ? undefined : { zoom: markdownZoom / 100 };

  const turnCount = conversation.turns.length;
  const pendingCount = pending.length;
  const sideBySide = layoutMode === 'side-by-side' && turnCount > 0;

  /*
   * `AssistantTurn` is memoized on its props, so building the meta object inline would hand it a
   * new identity on every render and re-render every answered turn for a zoom step, a layout
   * toggle or an unrelated pending turn. The conversation's provider is only a fallback for a
   * turn that did not record its own, so a turn that has one keeps the object the parser made.
   */
  const turnMetas = useMemo(
    () => conversation.turns.map((turn) => {
      const provider = turn.meta.p ?? conversation.provider ?? undefined;
      return provider === turn.meta.p ? turn.meta : { ...turn.meta, p: provider };
    }),
    [conversation.turns, conversation.provider],
  );
  // A `!` command's turn: its record split back into the command and what it printed.
  const shellTurns = useMemo(
    () => conversation.turns.map((turn) => {
      const shell = readTurnShell(turn.meta);
      const record = shell ? parseShellTurnPrompt(turn.prompt) : null;
      return shell && record ? { shell, ...record } : null;
    }),
    [conversation.turns],
  );
  const shellBubble = (index: number, bare: boolean): React.ReactNode => {
    const entry = shellTurns[index];
    if (!entry) return null;
    return (
      <ShellBubble
        command={entry.command}
        output={entry.output}
        shellLabel={entry.shell.s}
        folder={entry.shell.w}
        exitCode={entry.shell.x}
        stopped={entry.shell.k === 1}
        bare={bare}
        t={t}
      />
    );
  };

  // The temporary chat lives in memory only; there is no file to write an edit into.
  const editPath = conversationPath && conversationPath !== NEW_CONVERSATION_KEY ? conversationPath : undefined;
  const unsentEdits = useMemo(() => new Set(unsentEditedTurns(conversation.turns)), [conversation.turns]);
  const editPropsFor = (index: number) => {
    const edited = editedAt(conversation.turns[index]);
    return {
      editPath,
      editLocked: pendingCount > 0,
      turnCount,
      editedLabel: edited ? formatTime(edited) || null : null,
      editUnsent: unsentEdits.has(index),
      translatePath: conversationPath,
    };
  };

  // An agent waiting on this conversation is answered by the next message, not by an edited one.
  const questionWaiting = useAgentRunStore((state) => Boolean(conversationPath)
    && state.pendingQuestion?.conversationPath === conversationPath);
  const promptEditBlocked = pendingCount > 0
    ? t('chat.edit.lockedSending')
    : questionWaiting ? t('chat.edit.lockedQuestion') : null;
  const questionBubble = (index: number, bare: boolean): React.ReactNode => {
    const turn = conversation.turns[index];
    return shellBubble(index, bare) ?? (
      <UserBubble
        prompt={turn.prompt}
        t={t}
        attachments={turn.meta.a}
        attachmentFiles={turn.meta.af}
        turnIndex={index}
        bare={bare}
        {...(onEditPrompt && editPath ? { onEditPrompt, editBlockedReason: promptEditBlocked } : {})}
      />
    );
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const { follow, jump } = useStickToBottom(contentRef, sideBySide ? 'side' : 'stacked');
  const seenRef = useRef<ScrollSnapshot | null>(null);
  // A layout effect, so an opened conversation is never painted at the top first.
  useLayoutEffect(() => {
    const next = { path: conversationPath, turns: turnCount, pending: pendingCount };
    const move = scrollMoveFor(seenRef.current, next, runHeldOpen(conversation.turns.at(-1)?.meta.r));
    seenRef.current = next;
    if (move === 'jump') jump();
    else if (move === 'follow') follow();
  }, [conversationPath, conversation.turns, turnCount, pendingCount, follow, jump]);

  /*
   * Which turn just arrived, decided during render: an effect would paint the row once at full
   * opacity first. Latched to one index because `display: none` replays CSS animations and keys are
   * positional, so an unlatched class would re-animate old rows on every return to chat or
   * conversation switch. Cleared on animationend (see `handleTurnAnimationEnd`).
   */
  const [seenTurns, setSeenTurns] = useState({ path: conversationPath, count: turnCount });
  const [arrivedIndex, setArrivedIndex] = useState(-1);
  // Moved into a folder is the same conversation: no jump to the end, no re-entrance of the last turn.
  useConversationMoves((moves) => {
    const scrolledTo = movedPathFor(moves, seenRef.current?.path);
    if (seenRef.current && scrolledTo) seenRef.current = { ...seenRef.current, path: scrolledTo };
    setSeenTurns((prev) => {
      const to = movedPathFor(moves, prev.path);
      return to ? { ...prev, path: to } : prev;
    });
  });
  if (seenTurns.path !== conversationPath) {
    setSeenTurns({ path: conversationPath, count: turnCount });
    setArrivedIndex(-1);
  } else if (seenTurns.count !== turnCount) {
    setSeenTurns({ path: conversationPath, count: turnCount });
    setArrivedIndex(turnCount > seenTurns.count ? turnCount - 1 : -1);
  }

  // animationend bubbles, so a descendant finishing its own animation would clear the latch
  // early; only the row's own entrance counts.
  const handleTurnAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setArrivedIndex(-1);
  }, []);
  const turnEnterClass = (index: number): string | undefined => (index === arrivedIndex ? 'turn-enter' : undefined);

  const totalUsage = showTokenUsage ? sumTurnUsage(conversation.turns) : null;

  const title = conversation.title ? (
    <Group gap={10} align="flex-start" wrap="nowrap">
      <Stack gap={4} flex={1} miw={0}>
        <ConversationTitle title={conversation.title} edit={titleEdit} t={t} />
        {totalUsage && (
          <Group gap={0}>
            <TokenUsageLabel
              usage={totalUsage}
              labelKey="chat.tokens.conversationTotal"
              t={t}
              detail={totalUsage.countedTurns < turnCount
                ? fillTemplate(t('chat.tokens.partialTurns'), { counted: String(totalUsage.countedTurns), total: String(turnCount) })
                : undefined}
            />
          </Group>
        )}
      </Stack>
    </Group>
  ) : null;

  const pendingBubbles = pending.map((turn) => (
    <PendingTurnBubble key={turn.sendId} turn={turn} t={t} />
  ));

  if (sideBySide) {
    return (
      <Box ref={contentRef} style={zoomStyle}>
        <Stack gap={0} w="100%" maw={readingMaxWidth(fullWidth, SIDE_MAX_WIDTH)} mx="auto" px={24} py={20}>
          {title}
          {conversation.turns.map((turn, index) => (
            <Flex
              key={`turn-${index}`}
              className={turnEnterClass(index)}
              onAnimationEnd={handleTurnAnimationEnd}
              align="stretch"
              wrap="nowrap"
              style={{ borderTop: index > 0 ? '1px solid var(--border)' : undefined }}
            >
              <Box
                style={{
                  width: SIDE_QUESTION_WIDTH,
                  minWidth: 200,
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                  position: 'sticky',
                  top: SIDE_STICKY_TOP,
                  paddingRight: 20,
                  paddingTop: 20,
                  paddingBottom: 20,
                }}
              >
                {questionBubble(index, true)}
              </Box>
              <Box style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border)', padding: '20px 4px 20px 20px' }}>
                {turn.response ? (
                  <AssistantTurn
                    response={turn.response}
                    meta={turnMetas[index]}
                    formattedTime={formatTime(turn.meta.t ?? conversation.time ?? '') || null}
                    t={t}
                    turnIndex={index}
                    onCaptureAs={onCaptureTurnAs}
                    onChoose={onChooseAnswer}
                    onTurnButton={onTurnButton}
                    onAnalyzeXPost={onAnalyzeXPost}
                    {...editPropsFor(index)}
                  />
                ) : null}
              </Box>
            </Flex>
          ))}
          {pendingBubbles.length > 0 && <Stack gap={20} pt={20}>{pendingBubbles}</Stack>}
        </Stack>
      </Box>
    );
  }

  return (
    <Box ref={contentRef} style={{ minHeight: '100%', overflow: 'hidden' }}>
      <Box style={zoomStyle}>
        <Stack gap={28} w="100%" maw={readingMaxWidth(fullWidth, MAX_WIDTH)} mx="auto" px={28} py={20}>
          {title}

          {conversation.turns.map((turn, index) => (
            <Stack
              gap={20}
              key={`turn-${index}`}
              className={turnEnterClass(index)}
              onAnimationEnd={handleTurnAnimationEnd}
            >
              {questionBubble(index, false)}
              {turn.response
                ? (
                  <AssistantTurn
                    response={turn.response}
                    meta={turnMetas[index]}
                    formattedTime={formatTime(turn.meta.t ?? conversation.time ?? '') || null}
                    t={t}
                    turnIndex={index}
                    onCaptureAs={onCaptureTurnAs}
                    onChoose={onChooseAnswer}
                    onTurnButton={onTurnButton}
                    onAnalyzeXPost={onAnalyzeXPost}
                    {...editPropsFor(index)}
                  />
                )
                : null}
            </Stack>
          ))}

          {pendingBubbles}
        </Stack>
      </Box>
    </Box>
  );
}

export const ConversationView = React.memo(ConversationViewInner);
