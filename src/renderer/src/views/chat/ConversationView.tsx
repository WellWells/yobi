import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Group, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import type { CaptureFormat, CaptureTurn } from '../../../../shared/types';
import { sumTurnUsage } from '../../../../shared/tokenEstimate';
import { useAppStore, type PendingTurn } from '../../store/appStore';
import type { AgentChoicePick } from '../../store/useAgentRunStore';
import { useI18nStore } from '../../store/i18nStore';
import { useFormatTime } from '../../hooks/useFormatTime';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import { UserBubble } from '../../components/chat/UserBubble';
import { PromptBody } from '../../components/chat/PromptBody';
import { AssistantTurn } from '../../components/chat/AssistantTurn';
import { PendingTurnBubble } from '../../components/chat/PendingTurnBubble';
import { TokenUsageLabel } from '../../components/chat/TokenUsageLabel';

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
}

function ConversationViewInner({ conversation, conversationPath, onCaptureTurnAs, onChooseAnswer }: ConversationViewProps) {
  const { t } = useI18nStore();
  const formatTime = useFormatTime();
  const markdownZoom = useAppStore((state) => state.markdownZoom);
  const layoutMode = useAppStore((state) => state.layoutMode);
  const showTokenUsage = useAppStore((state) => state.showTokenUsage);
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

  const contentRef = useRef<HTMLDivElement>(null);
  const { follow, release } = useStickToBottom(contentRef, sideBySide ? 'side' : 'stacked');
  const seenRef = useRef({ path: conversationPath, turns: turnCount, pending: pendingCount });
  useEffect(() => {
    const seen = seenRef.current;
    const switched = seen.path !== conversationPath;
    const appended = !switched && (turnCount > seen.turns || pendingCount > seen.pending);
    seenRef.current = { path: conversationPath, turns: turnCount, pending: pendingCount };
    if (switched) release();
    else if (appended) follow();
  }, [conversationPath, turnCount, pendingCount, follow, release]);

  /*
   * Which turn just arrived, decided during render rather than in an effect: an effect would
   * commit the row once without the class and only then add it, so the animation would restart
   * after a frame at full opacity — a visible flash. This is React's "adjust state when props
   * change" pattern; the re-render happens before anything is painted.
   *
   * It has to be latched to a single index. This view lives under `display: none`, which cancels
   * and replays CSS animations, so an unlatched class would re-run on every return to chat — and
   * the keys are positional (`turn-${index}`), so a conversation switch would animate old rows as
   * if they were new. The class is dropped again on animationend (see `handleTurnAnimationEnd`).
   */
  const [seenTurns, setSeenTurns] = useState({ path: conversationPath, count: turnCount });
  const [arrivedIndex, setArrivedIndex] = useState(-1);
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
      <Stack gap={4} flex={1}>
        <Text
          component="h1"
          fz="var(--font-size-3xl)"
          fw={700}
          c="var(--text-primary)"
          lh={1.4}
          style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
        >
          {conversation.title}
        </Text>
        {totalUsage && (
          <Group gap={0}>
            <TokenUsageLabel
              usage={totalUsage}
              labelKey="chat.tokens.conversationTotal"
              t={t}
              detail={totalUsage.countedTurns < turnCount
                ? t('chat.tokens.partialTurns')
                  .replace('{{counted}}', String(totalUsage.countedTurns))
                  .replace('{{total}}', String(turnCount))
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
        <Stack gap={0} w="100%" maw={SIDE_MAX_WIDTH} mx="auto" px={24} py={20}>
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
                <PromptBody prompt={turn.prompt} fw={500} />
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
        <Stack gap={28} w="100%" maw={MAX_WIDTH} mx="auto" px={28} py={20}>
          {title}

          {conversation.turns.map((turn, index) => (
            <Stack
              gap={20}
              key={`turn-${index}`}
              className={turnEnterClass(index)}
              onAnimationEnd={handleTurnAnimationEnd}
            >
              <UserBubble prompt={turn.prompt} t={t} attachments={turn.meta.a} />
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
