import React from 'react';
import { Group, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { YobiMark } from '../../config/brandIcons';
import { readLastActivity } from '../../utils/lastActivity';
import { ShortcutHint } from '../ShortcutHint';
import type { ShortcutId } from '../../../../shared/shortcuts';
import { resolveGreeting } from './greeting';

/** The greeting that sits directly above the composer on an empty chat. */
export const WelcomeScreen: React.FC = () => {
  const userNickname = useAppStore((s) => s.userNickname);
  const { t, translations, enTranslations } = useI18nStore(
    useShallow((s) => ({ t: s.t, translations: s.translations, enTranslations: s.enTranslations })),
  );

  const greeting = resolveGreeting(new Date(), userNickname.trim(), {
    t,
    has: (key) => Object.hasOwn(translations, key),
    hasFallback: (key) => Object.hasOwn(enTranslations, key),
  }, readLastActivity());

  return (
    <Group justify="center" gap={12} wrap="nowrap" px={20} pb={12}>
      {greeting && <YobiMark size={32} />}
      <Text fw={500} fz="var(--font-size-display)" lts="-0.01em" c="var(--mantine-color-text)" miw={0} truncate>
        {greeting}
      </Text>
    </Group>
  );
};

/**
 * A keycap and the shortcut's name, the same name the Shortcuts page gives it. Draws nothing for
 * a shortcut that is switched off.
 */
export const ShortcutRow: React.FC<{ id: ShortcutId; combo: string }> = ({ id, combo }) => {
  const t = useI18nStore((s) => s.t);
  if (!combo) return null;
  return (
    <Group gap={6} align="center" wrap="nowrap">
      <ShortcutHint combo={combo} />
      <Text fz="var(--font-size-sm)" c="dimmed">{t(`settings.shortcut.${id}`)}</Text>
    </Group>
  );
};

/** The global-hotkey hint under the composer on an empty chat; the model pill's tooltip already names Shift+Tab. */
export const WelcomeHints: React.FC = () => {
  const { hotkey, hotkeyEnabled } = useAppStore(
    useShallow((s) => ({ hotkey: s.hotkey, hotkeyEnabled: s.hotkeyEnabled })),
  );

  if (!hotkeyEnabled || !hotkey) return null;
  return (
    <Group justify="center" px={20} pt={10}>
      <ShortcutRow id="global.ask" combo={hotkey} />
    </Group>
  );
};
