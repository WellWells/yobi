import React, { useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import {
  Bot, CalendarClock, Check, Coins, ExternalLink, FileText, History, Info, Layers, Link2, MessagesSquare, Paperclip, Timer,
} from 'lucide-react';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import { formatCardTime } from '../../../../shared/captureCard';
import { clipboardApi } from '../../api/electronApi';
import { useI18nStore } from '../../store/i18nStore';
import { formatByteSize } from '../../utils/byteSize';
import {
  contextValueText, durationValueText, fillTemplate as fill, summarizeConversation, tokensValueText,
} from '../../utils/conversationInfo';
import { AppButton } from '../AppButton';
import { AppModal } from '../AppModal';
import { ProviderTag } from '../ProviderTag';
import { SettingRow } from '../SettingRow';

interface ConversationInfoDialogProps {
  open: boolean;
  onClose: () => void;
  /** After the closing transition: where focus goes, since the menu row that opened it is gone. */
  onClosed?: () => void;
  conversation: ConversationDoc | null;
  content: string;
  filePath: string;
}

const NUMERIC = { fontVariantNumeric: 'tabular-nums' } as const;

const Value: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fz="var(--font-size-base)" c="var(--text-primary)" ta="right" style={NUMERIC}>{children}</Text>
);

export const ConversationInfoDialog: React.FC<ConversationInfoDialogProps> = ({
  open, onClose, onClosed, conversation, content, filePath,
}) => {
  const { t, locale } = useI18nStore();
  const [pathCopied, setPathCopied] = useState(false);
  const info = useMemo(
    () => (conversation ? summarizeConversation(conversation, content) : null),
    [conversation, content],
  );

  const handleCopyPath = (): void => {
    void clipboardApi.copyText(filePath).then(() => {
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1_600);
    });
  };

  const durationHint = (): string => {
    if (!info?.durations) return t('chat.info.durationNone');
    if (info.durations.timedTurns < info.turns) {
      return fill(t('chat.info.durationPartial'), { total: info.turns, counted: info.durations.timedTurns });
    }
    return t('chat.info.durationHint');
  };

  const tokenHint = (): string => {
    if (!info?.tokens) return '';
    if (info.tokens.countedTurns < info.turns) {
      return fill(t('chat.tokens.partialTurns'), { total: info.turns, counted: info.tokens.countedTurns });
    }
    return info.tokens.exact ? '' : t('chat.info.tokensEstimated');
  };

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      onExitTransitionEnd={onClosed}
      icon={<Info size={16} />}
      title={t('chat.info.title')}
      size="md"
      zIndex={90}
    >
      {info && (
        <Stack gap={14}>
          <SettingRow
            icon={<CalendarClock size={13} />}
            label={t('chat.info.started')}
            control={<Value>{formatCardTime(info.startedAt, locale) || '—'}</Value>}
          />
          <SettingRow
            icon={<History size={13} />}
            label={t('chat.info.lastActive')}
            control={<Value>{formatCardTime(info.lastActiveAt, locale) || '—'}</Value>}
          />
          <SettingRow
            icon={<MessagesSquare size={13} />}
            label={t('chat.info.turns')}
            control={<Value>{fill(t('chat.info.turnsValue'), { count: info.turns })}</Value>}
          />
          {info.models.length > 0 && (
            <SettingRow
              icon={<Bot size={13} />}
              label={t('chat.info.models')}
              alignStart
              control={(
                <Group gap={8} justify="flex-end" maw={260}>
                  {info.models.map((model) => (
                    <Group key={model.name} gap={4} wrap="nowrap">
                      <ProviderTag provider={model.name} />
                      {info.models.length > 1 && (
                        <Text fz="var(--font-size-sm)" c="var(--text-secondary)" style={NUMERIC}>×{model.turns}</Text>
                      )}
                    </Group>
                  ))}
                </Group>
              )}
            />
          )}
          <SettingRow
            icon={<Coins size={13} />}
            label={t('chat.info.tokens')}
            hint={tokenHint() || undefined}
            alignStart
            control={(
              <Value>{tokensValueText(info, t) || '—'}</Value>
            )}
          />
          <SettingRow
            icon={<Timer size={13} />}
            label={t('chat.info.duration')}
            hint={durationHint()}
            alignStart
            control={(
              <Value>{durationValueText(info, t) || '—'}</Value>
            )}
          />
          {(info.context.summarized > 0 || info.context.dropped > 0) && (
            <SettingRow
              icon={<Layers size={13} />}
              label={t('chat.info.context')}
              hint={t('chat.info.contextHint')}
              alignStart
              control={(
                <Stack gap={2} align="flex-end">
                  {contextValueText(info, t).map((line) => <Value key={line}>{line}</Value>)}
                </Stack>
              )}
            />
          )}
          {info.attachments.length > 0 && (
            <SettingRow
              icon={<Paperclip size={13} />}
              label={t('chat.info.attachments')}
              hint={info.attachments.join(' · ')}
              alignStart
              control={<Value>{info.attachments.length}</Value>}
            />
          )}
          <SettingRow
            icon={<FileText size={13} />}
            label={t('chat.info.file')}
            hint={(
              <Text component="span" fz="var(--font-size-sm)" ff="var(--font-mono)" style={{ wordBreak: 'break-all' }}>
                {filePath}
              </Text>
            )}
            alignStart
            control={<Value>{formatByteSize(info.sizeBytes)}</Value>}
          />

          <Group justify="space-between" gap={8} mt={4}>
            <AppButton
              variant="subtle"
              leftSection={pathCopied ? <Check size={14} /> : <Link2 size={14} />}
              onClick={handleCopyPath}
            >
              {pathCopied ? t('common.copied') : t('chat.info.copyPath')}
            </AppButton>
            {info.threadUrl && (
              <AppButton
                variant="outline"
                leftSection={<ExternalLink size={14} />}
                onClick={() => { void clipboardApi.openExternalUrl(info.threadUrl); }}
              >
                {t('chat.info.openThread')}
              </AppButton>
            )}
          </Group>
        </Stack>
      )}
    </AppModal>
  );
};
