import React, { useCallback, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Text, Tooltip } from '@mantine/core';
import { Check, Copy, FileText, Image } from 'lucide-react';
import type { TurnMeta } from '../../../../shared/conversationDoc';
import type { CaptureFormat, CaptureTurn } from '../../../../shared/types';
import type { TokenUsage } from '../../../../shared/tokenEstimate';
import { useAppStore } from '../../store/appStore';
import { useAgentRunStore, type AgentChoicePick } from '../../store/useAgentRunStore';
import { clipboardApi } from '../../api/electronApi';
import { AppButton } from '../AppButton';
import { TokenUsageLabel } from './TokenUsageLabel';
import { chatModeLabelKeyForCommand } from '../../config/chatModes';
import { MessageMarkdown } from './MessageMarkdown';
import { TurnTrace } from './TurnTrace';
import { MemoryNotes } from './MemoryNotes';
import styles from './AssistantTurn.module.css';

const CAPTURE_ACTIONS = [
  { format: 'png' as CaptureFormat, labelKey: 'chat.copyAsPng', Icon: Image },
  { format: 'pdf' as CaptureFormat, labelKey: 'chat.copyAsPdf', Icon: FileText },
];

interface AssistantTurnProps {
  response: string;
  meta: TurnMeta;
  formattedTime: string | null;
  t: (key: string) => string;
  turnIndex?: number;
  onCaptureAs?: (format: CaptureFormat, turn: CaptureTurn) => Promise<boolean>;
  /** Answers the agent's waiting question with the picked choice, addressed to the run that asked it. */
  onChoose?: (pick: AgentChoicePick) => void;
}

export const AssistantTurn = React.memo<AssistantTurnProps>(({ response, meta, formattedTime, t, turnIndex, onCaptureAs, onChoose }) => {
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState<CaptureFormat | null>(null);
  const [captured, setCaptured] = useState<CaptureFormat | null>(null);
  const showTokenUsage = useAppStore((state) => state.showTokenUsage);
  // Only the question still waiting is marked: an answered one is just part of the conversation.
  const awaiting = useAgentRunStore((state) => Boolean(meta.r) && state.pendingQuestion?.runId === meta.r);
  const runId = meta.r;
  const choices = awaiting && onChoose && runId ? meta.ch ?? [] : [];

  const commandLabel = meta.c
    ? (() => {
      const labelKey = chatModeLabelKeyForCommand(meta.c);
      return labelKey ? t(labelKey) : `/${meta.c}`;
    })()
    : null;

  const usage: TokenUsage | null = (typeof meta.ti === 'number' || typeof meta.to === 'number')
    ? { input: meta.ti ?? 0, output: meta.to ?? 0, exact: meta.tx === 1 }
    : null;

  const handleCopy = useCallback((): void => {
    void clipboardApi.copyText(response).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  }, [response]);

  const handleCaptureAs = useCallback((format: CaptureFormat): void => {
    if (!onCaptureAs || capturing) return;
    setCapturing(format);
    void onCaptureAs(format, {
      prompt: '',
      response,
      provider: meta.p ?? '',
      timestamp: formattedTime ?? '',
    }).then((ok) => {
      setCapturing(null);
      if (!ok) return;
      setCaptured(format);
      window.setTimeout(() => setCaptured(null), 1_600);
    });
  }, [onCaptureAs, capturing, response, meta.p, formattedTime]);

  return (
    <Box className={styles.turn} data-turn-index={turnIndex}>
      <Group gap={8} mb={6} align="center">
        {meta.p && (
          <Text fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)">
            {meta.p}
          </Text>
        )}
        {formattedTime && (
          <Text fz="var(--font-size-sm)" c="dimmed">
            {formattedTime}
          </Text>
        )}
        {commandLabel && (
          <Badge variant="light" size="sm" radius="sm">
            {commandLabel}
          </Badge>
        )}
        {awaiting && (
          <Badge variant="light" size="sm" radius="sm">
            {t('agent.question.waiting')}
          </Badge>
        )}
        {
}
        {meta.m === 'replay' && (
          <Badge variant="light" size="sm" radius="sm">
            {t('chat.context.degraded')}
          </Badge>
        )}
        {typeof meta.summarized === 'number' && meta.summarized > 0 && (
          <Badge variant="light" size="sm" radius="sm">
            {t('chat.context.summarized').replace('{{count}}', String(meta.summarized))}
          </Badge>
        )}
        {typeof meta.dropped === 'number' && meta.dropped > 0 && (
          <Badge variant="light" size="sm" radius="sm">
            {t('chat.context.dropped').replace('{{count}}', String(meta.dropped))}
          </Badge>
        )}
        {usage && showTokenUsage && (
          <TokenUsageLabel usage={usage} labelKey="chat.tokens.label" t={t} />
        )}
      </Group>

      <Box
        className="md-content md-response"
        style={{ fontSize: 'var(--font-size-md)', lineHeight: 1.75, color: 'var(--text-primary)' }}
      >
        <MessageMarkdown>{response}</MessageMarkdown>
      </Box>

      {meta.mem && <MemoryNotes raw={meta.mem} t={t} />}

      {choices.length > 0 && (
        <Group gap={6} mt={10} wrap="wrap">
          {choices.map((choice) => (
            <AppButton
              key={choice}
              variant="light"
              size="compact-sm"
              h="auto"
              py={4}
              styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.5 } }}
              onClick={() => { if (runId) onChoose?.({ runId, text: choice }); }}
            >
              {choice}
            </AppButton>
          ))}
        </Group>
      )}

      {meta.r && <TurnTrace runId={meta.r} t={t} />}

      {
}
      <Group
        gap={4}
        mt={6}
        className={styles.actions}
        data-copied={copied || capturing !== null || captured !== null || undefined}
      >
        <Tooltip label={copied ? t('chat.copied') : t('chat.copy')} position="bottom">
          <ActionIcon
            variant="subtle"
            size="sm"
            c="dimmed"
            aria-label={t('chat.copy')}
            onClick={handleCopy}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionIcon>
        </Tooltip>
        {onCaptureAs && CAPTURE_ACTIONS.map(({ format, labelKey, Icon }) => (
          <Tooltip key={format} label={captured === format ? t('chat.copied') : t(labelKey)} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t(labelKey)}
              disabled={capturing !== null}
              loading={capturing === format}
              onClick={() => handleCaptureAs(format)}
            >
              {captured === format ? <Check size={14} /> : <Icon size={14} />}
            </ActionIcon>
          </Tooltip>
        ))}
      </Group>
    </Box>
  );
});
