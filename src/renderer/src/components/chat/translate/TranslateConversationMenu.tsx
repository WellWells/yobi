import React, { useMemo } from 'react';
import { Menu, Stack, Text } from '@mantine/core';
import { Languages } from 'lucide-react';
import type { ConversationDoc } from '../../../../../shared/conversationDoc';
import { defaultTargetLanguage } from '../../../../../shared/translateLanguages';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { SUB_POSITION } from '../headerMenu/headerMenuModel';
import { LanguageMenuItems } from './LanguageMenuItems';
import { translateConversation } from './conversationTranslateActions';

interface TranslateConversationMenuProps {
  path: string;
  conversation: ConversationDoc;
  onClose: () => void;
  t: (key: string) => string;
}

/** Enough of the conversation to tell which language it is in. */
const SAMPLE_CHARS = 4_000;

/** ⋮ › "Translate the whole conversation ▸": a searchable language list; the copy opens when it is done. */
export const TranslateConversationMenu: React.FC<TranslateConversationMenuProps> = ({ path, conversation, onClose, t }) => {
  const locale = useI18nStore((s) => s.locale);
  const recent = useTranslateStore((s) => s.recent);
  const running = useTranslateStore((s) => s.conversation !== null);
  const defaultTag = useMemo(() => {
    const sample = conversation.turns.map((turn) => turn.response).join('\n\n').slice(0, SAMPLE_CHARS);
    return defaultTargetLanguage(sample, locale, recent);
  }, [conversation.turns, locale, recent]);

  if (running) {
    return (
      <Menu.Item leftSection={<Languages size={14} />} disabled>
        <Stack gap={2}>
          <Text inherit>{t('chat.translate.conversation.menu')}</Text>
          <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ whiteSpace: 'normal' }}>
            {t('chat.translate.conversation.runningReason')}
          </Text>
        </Stack>
      </Menu.Item>
    );
  }

  return (
    <Menu.Sub position={SUB_POSITION}>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={<Languages size={14} />}>{t('chat.translate.conversation.menu')}</Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown miw={200}>
        <LanguageMenuItems
          defaultTag={defaultTag}
          subPosition={SUB_POSITION}
          searchFocus="keyboard"
          onPick={(tag) => {
            onClose();
            void translateConversation(path, tag);
          }}
          t={t}
        />
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
};
