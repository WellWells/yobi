import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { ShortcutHint } from '../ShortcutHint';
import { useResolvedCombo } from '../../store/shortcutStore';
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
  });

  return (
    <Stack align="center" px={20} pb={12}>
      <Text fw={500} fz="var(--font-size-display)" lts="-0.01em" c="var(--mantine-color-text)" maw="100%" truncate>
        {greeting}
      </Text>
    </Stack>
  );
};

export const ShortcutRow: React.FC<{ combo: string; label: string }> = ({ combo, label }) => (
  <Group gap={6} align="center" wrap="nowrap">
    <ShortcutHint combo={combo} />
    <Text fz="var(--font-size-sm)" c="dimmed">{label}</Text>
  </Group>
);

/** The shortcut hints that sit under the composer on an empty chat. */
export const WelcomeHints: React.FC = () => {
  const cycleModelCombo = useResolvedCombo('chat.cycleModel');
  const { hotkey, hotkeyEnabled } = useAppStore(
    useShallow((s) => ({ hotkey: s.hotkey, hotkeyEnabled: s.hotkeyEnabled })),
  );
  const t = useI18nStore((s) => s.t);

  return (
    <Group justify="center" gap={20} px={20} pt={10}>
      {hotkeyEnabled && hotkey && <ShortcutRow combo={hotkey} label={t('welcome.shortcut.ask')} />}
      <ShortcutRow combo={cycleModelCombo} label={t('welcome.shortcut.switchModel')} />
    </Group>
  );
};
