import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Loader, Text, Tooltip } from '@mantine/core';
import { Check, Copy, Languages, RefreshCw, Replace, Trash, TriangleExclamationPoint, X } from 'lucide-react';
import type { TurnTranslation } from '../../../../../shared/conversationDoc';
import { isTranslateLanguage, languageDisplayName } from '../../../../../shared/translateLanguages';
import { clipboardApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import type { TurnTranslateJob } from '../../../store/translateStore';
import { READING_TEXT_STYLE } from '../../../styles/readingText';
import { AppButton } from '../../AppButton';
import { MessageMarkdown } from '../MessageMarkdown';
import {
  cancelTurnTranslation, convertTurnToTraditional, removeTurnTranslation, replaceAnswerWithTranslation, translateTurn,
} from './translateActions';
import { useProviderLabel } from './useTurnTranslation';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface TranslationBlockProps {
  path: string;
  turnIndex: number;
  response: string;
  translation: TurnTranslation | null;
  outdated: boolean;
  job: TurnTranslateJob | undefined;
  /**
   * "Replace original" puts the translation in place of the answer. Null when the answer cannot be
   * edited at all (the temporary chat); `blocked` says why it cannot be right now.
   */
  replace: { turnCount: number; editedAt: string | null; blocked: string | null } | null;
  t: (key: string) => string;
}

const FRAME_STYLE = {
  border: '1px solid var(--border)',
  borderLeft: '3px solid var(--accent)',
  borderRadius: 'var(--mantine-radius-md)',
  background: 'var(--bg-secondary)',
} as const;

/**
 * An answer's translation, under the answer and outside it: not part of the answer's text (the
 * selection tools leave it alone) and labelled with who made it, so it never reads as the original
 * reply. It is always shown in full under the answer; to read only the translation, replace the
 * answer with it. Ctrl+F searches the translated text itself, but not the header's labels and buttons.
 */
export const TranslationBlock: React.FC<TranslationBlockProps> = ({
  path, turnIndex, response, translation, outdated, job, replace, t,
}) => {
  const locale = useI18nStore((s) => s.locale);
  const providerLabel = useProviderLabel();
  const [copied, setCopied] = useState(false);
  const [replacing, setReplacing] = useState(false);

  if (job && job.status !== 'error') {
    return (
      <Group data-selection-ignore data-find-omit mt={10} px={12} py={8} gap={8} wrap="nowrap" style={FRAME_STYLE}>
        <Loader size={14} />
        <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)" style={{ flex: 1 }}>
          {t(job.by === 'opencc' ? 'chat.translate.converting' : `chat.translate.${job.status}`)}
        </Text>
        <AppButton size="compact-sm" variant="default" onClick={() => cancelTurnTranslation(path, turnIndex)}>
          {t('chat.rewrite.cancel')}
        </AppButton>
      </Group>
    );
  }

  if (job?.status === 'error') {
    return (
      <Group data-selection-ignore data-find-omit mt={10} px={12} py={8} gap={8} wrap="nowrap" align="flex-start" style={FRAME_STYLE}>
        <Box c="var(--error-text)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleExclamationPoint size={14} /></Box>
        <Text component="div" fz="var(--font-size-sm)" c="var(--error-text)" style={{ flex: 1 }}>{job.error}</Text>
        <AppButton
          size="compact-sm"
          variant="default"
          onClick={() => {
            if (job.by === 'opencc') void convertTurnToTraditional({ path, turnIndex, response });
            else void translateTurn({ path, turnIndex, response, to: job.to, providerLabel });
          }}
        >
          {t('chat.rewrite.retry')}
        </AppButton>
        <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.dismiss')} onClick={() => cancelTurnTranslation(path, turnIndex)}>
          <X size={12} />
        </ActionIcon>
      </Group>
    );
  }

  if (!translation) return null;

  const language = isTranslateLanguage(translation.to) ? languageDisplayName(translation.to, locale) : translation.to;
  const source = translation.by === 'opencc'
    ? t('chat.translate.byLocal')
    : fillTemplate(t('chat.translate.byProvider'), { provider: translation.p ?? '' });

  const copy = (): void => {
    void clipboardApi.copyText(translation.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  };

  const retranslate = (): void => {
    if (translation.by === 'opencc') void convertTurnToTraditional({ path, turnIndex, response });
    else if (isTranslateLanguage(translation.to)) void translateTurn({ path, turnIndex, response, to: translation.to, providerLabel });
  };

  // A translation of an earlier answer would put back text the answer no longer says.
  const canReplace = replace !== null && !outdated;
  const replaceBlocked = replace?.blocked ?? null;
  const replaceAnswer = (): void => {
    if (!replace || replacing || replaceBlocked) return;
    setReplacing(true);
    void replaceAnswerWithTranslation({
      path, turnIndex, turnCount: replace.turnCount, editedAt: replace.editedAt, response, text: translation.text,
    }).finally(() => setReplacing(false));
  };

  return (
    <Box data-selection-ignore mt={10} style={FRAME_STYLE}>
      <Group data-find-omit justify="space-between" wrap="wrap" gap={8} px={12} pt={8} pb={0}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Languages size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <Text component="div" fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)" truncate>
            {fillTemplate(t('chat.translate.title'), { language })}
          </Text>
          <Tooltip
            label={translation.by === 'opencc' ? t('chat.translate.byLocal.hint') : t('chat.translate.providerHint')}
            position="bottom"
            multiline
            maw={280}
          >
            <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" style={{ flexShrink: 0 }}>{source}</Text>
          </Tooltip>
          {outdated && <Badge variant="light" size="sm">{t('chat.translate.outdated')}</Badge>}
        </Group>
        <Group gap={4} wrap="nowrap">
          {canReplace && (
            <Tooltip label={replaceBlocked ?? t('chat.translate.replace.hint')} position="bottom" multiline maw={260}>
              <AppButton
                size="compact-sm"
                variant="light"
                leftSection={<Replace size={14} />}
                loading={replacing}
                // data-disabled keeps pointer events, so the tooltip saying why can still show.
                data-disabled={replaceBlocked !== null || undefined}
                onClick={replaceAnswer}
              >
                {t('chat.translate.replace')}
              </AppButton>
            </Tooltip>
          )}
          <Tooltip label={copied ? t('chat.copied') : t('chat.translate.copy')} position="bottom">
            <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.copy')} onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('chat.translate.again')} position="bottom">
            <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.translate.again')} onClick={retranslate}>
              <RefreshCw size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t('chat.translate.remove')} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('chat.translate.remove')}
              onClick={() => { void removeTurnTranslation(path, turnIndex, response); }}
            >
              <Trash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {translation.unmatched && (
        <Group data-find-omit gap={6} px={12} pt={6} wrap="nowrap" align="flex-start">
          <Box c="var(--warning-text)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleExclamationPoint size={13} /></Box>
          <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)">{t('chat.translate.unmatched')}</Text>
        </Group>
      )}

      <Box
        className="md-content"
        data-find-scope
        px={12}
        pt={6}
        pb={10}
        style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}
      >
        <MessageMarkdown>{translation.text}</MessageMarkdown>
      </Box>
    </Box>
  );
};
