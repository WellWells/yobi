import React, { useEffect, useRef } from 'react';
import { Box, Flex, Group, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import type { CaptureFormat, CaptureTurn } from '../../../../shared/types';
import { sumTurnUsage } from '../../../../shared/tokenEstimate';
import { useAppStore, type PendingTurn } from '../../store/appStore';
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
}

function ConversationViewInner({ conversation, conversationPath, onCaptureTurnAs }: ConversationViewProps) {
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
                    meta={{ ...turn.meta, p: turn.meta.p ?? conversation.provider ?? undefined }}
                    formattedTime={formatTime(turn.meta.t ?? conversation.time ?? '') || null}
                    t={t}
                    turnIndex={index}
                    onCaptureAs={onCaptureTurnAs}
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
            <Stack gap={20} key={`turn-${index}`}>
              <UserBubble prompt={turn.prompt} t={t} />
              {turn.response
                ? (
                  <AssistantTurn
                    response={turn.response}
                    meta={{ ...turn.meta, p: turn.meta.p ?? conversation.provider ?? undefined }}
                    formattedTime={formatTime(turn.meta.t ?? conversation.time ?? '') || null}
                    t={t}
                    turnIndex={index}
                    onCaptureAs={onCaptureTurnAs}
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
