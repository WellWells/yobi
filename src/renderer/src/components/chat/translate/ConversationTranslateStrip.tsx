import React from 'react';
import { Group, Loader, Text } from '@mantine/core';
import { languageDisplayName } from '../../../../../shared/translateLanguages';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { AppButton } from '../../AppButton';
import { cancelConversationTranslation } from './conversationTranslateActions';
import { fillTemplate } from '../../../../../shared/fillTemplate';

/**
 * "Translating the whole conversation: 3/12" with a cancel, above the composer while it runs.
 * The copy is written only at the end, so cancelling leaves nothing behind.
 */
export const ConversationTranslateStrip: React.FC<{ t: (key: string) => string }> = ({ t }) => {
  const job = useTranslateStore((s) => s.conversation);
  const locale = useI18nStore((s) => s.locale);
  if (!job) return null;
  const progress = job.total > 0 ? `${Math.min(job.done + 1, job.total)}/${job.total}` : '';
  const key = job.phase === 'waiting' ? 'chat.translate.conversation.waiting' : 'chat.translate.conversation.progress';
  return (
    <Group
      gap={8}
      wrap="nowrap"
      px={12}
      py={6}
      style={{ border: '1px solid var(--border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--bg-secondary)' }}
    >
      <Loader size={14} />
      <Text
        component="div"
        fz="var(--font-size-sm)"
        c="var(--text-secondary)"
        truncate
        style={{ flex: 1, minWidth: 0, fontVariantNumeric: 'tabular-nums' }}
      >
        {fillTemplate(t(key), { language: languageDisplayName(job.to, locale), progress })}
      </Text>
      <AppButton size="compact-sm" variant="default" disabled={job.cancelling} onClick={cancelConversationTranslation}>
        {t('chat.rewrite.cancel')}
      </AppButton>
    </Group>
  );
};
