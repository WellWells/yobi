import React, { useMemo, useState } from 'react';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { Languages } from 'lucide-react';
import {
  defaultTargetLanguage, languageDisplayName, type TranslateLanguage,
} from '../../../../../shared/translateLanguages';
import { useI18nStore } from '../../../store/i18nStore';
import { useTranslateStore } from '../../../store/translateStore';
import { AppButton } from '../../AppButton';
import { LanguageMenuItems } from './LanguageMenuItems';
import { convertTurnToTraditional, translateTurn } from './translateActions';
import { useProviderLabel } from './useTurnTranslation';
import { turnTranslateOffer } from './turnTranslateOffer';

interface TurnTranslateControlsProps {
  path: string;
  turnIndex: number;
  response: string;
  /** The turn's command (`c`): a pasted link's built-in gets no unasked offer. */
  command?: string;
  /** The answer already has a translation, or one is on its way: no suggestion then. */
  translated: boolean;
  busy: boolean;
  /** The menu is open: the action row stays visible while the pointer is in the menu. */
  onMenuOpenChange: (open: boolean) => void;
  t: (key: string) => string;
}

/**
 * The answer's translation actions on its action row: the language menu, "convert to Traditional"
 * when a zh-TW reader meets Simplified characters, and — offered, never done unasked — "translate
 * into <UI language>" when the answer is written in another script.
 */
export const TurnTranslateControls: React.FC<TurnTranslateControlsProps> = ({
  path, turnIndex, response, command, translated, busy, onMenuOpenChange, t,
}) => {
  const locale = useI18nStore((s) => s.locale);
  const recent = useTranslateStore((s) => s.recent);
  const providerLabel = useProviderLabel();
  const defaultTag = useMemo(() => defaultTargetLanguage(response, locale, recent), [response, locale, recent]);
  const { suggestion, traditional: offerTraditional } = useMemo(
    () => turnTranslateOffer(response, locale, command, translated),
    [response, locale, command, translated],
  );

  // The icon's tooltip sits right where the open menu's search box is: hidden while the menu is open.
  const [menuOpen, setMenuOpen] = useState(false);

  const translate = (to: TranslateLanguage): void => {
    void translateTurn({ path, turnIndex, response, to, providerLabel });
  };

  const handleMenuChange = (open: boolean): void => {
    setMenuOpen(open);
    onMenuOpenChange(open);
  };

  return (
    <>
      <Menu
        position="bottom-start"
        withinPortal
        shadow="md"
        onChange={handleMenuChange}
        disabled={busy}
        // The language search takes the initial focus, not Mantine's placeholder.
        withInitialFocusPlaceholder={false}
      >
        <Menu.Target>
          <Tooltip
            label={busy ? t('chat.translate.busy') : t('chat.translate.action')}
            position="bottom"
            disabled={menuOpen}
          >
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('chat.translate.action')}
              data-disabled={busy || undefined}
            >
              <Languages size={14} />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown miw={200}>
          <LanguageMenuItems defaultTag={defaultTag} onPick={translate} t={t} />
        </Menu.Dropdown>
      </Menu>
      {offerTraditional && !busy && (
        <Tooltip label={t('chat.translate.toTraditional.hint')} position="bottom" multiline maw={260}>
          <AppButton
            variant="subtle"
            size="compact-xs"
            c="dimmed"
            onClick={() => { void convertTurnToTraditional({ path, turnIndex, response }); }}
          >
            {t('chat.translate.toTraditional')}
          </AppButton>
        </Tooltip>
      )}
      {suggestion && !offerTraditional && !busy && (
        <AppButton
          variant="light"
          size="compact-xs"
          leftSection={<Languages size={12} />}
          onClick={() => translate(suggestion)}
        >
          {t('chat.translate.suggest').replace('{{language}}', languageDisplayName(suggestion, locale))}
        </AppButton>
      )}
    </>
  );
};
