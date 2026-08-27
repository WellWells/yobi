import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { findModelOption } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { ShortcutHint } from '../ShortcutHint';
import { useResolvedCombo } from '../../store/shortcutStore';
import { resolveGreeting } from './greeting';
import styles from '../../views/ChatView.module.css';

const WelcomeStepCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box className={styles.stepCard}>{children}</Box>
);

export const WelcomeScreen: React.FC<{ activeModelUrl: string }> = ({ activeModelUrl }) => {
  const cycleModelCombo = useResolvedCombo('chat.cycleModel');
  const { hotkey, hotkeyEnabled, userNickname } = useAppStore(
    useShallow((s) => ({
      hotkey: s.hotkey,
      hotkeyEnabled: s.hotkeyEnabled,
      userNickname: s.userNickname,
    })),
  );
  const { extraModels } = useProviderModels();
  const { t, translations, enTranslations } = useI18nStore(
    useShallow((s) => ({ t: s.t, translations: s.translations, enTranslations: s.enTranslations })),
  );
  const providerLabel = findModelOption(activeModelUrl, extraModels).label;
  const welcomeHint = t('welcome.hint').replace('{{provider}}', providerLabel);

  const greeting = resolveGreeting(new Date(), userNickname.trim(), {
    t,
    has: (key) => Object.hasOwn(translations, key),
    hasFallback: (key) => Object.hasOwn(enTranslations, key),
  });

  return (
    <Stack align="center" justify="center" gap={18} h="100%" c="dimmed" p="24px 20px">
      <Group gap={12} align="center" wrap="nowrap" maw="100%">
        <Sparkles size={26} color="var(--mantine-color-accent)" style={{ flexShrink: 0 }} />
        <Text fw={600} fz="var(--font-size-3xl)" lts="-0.01em" c="var(--mantine-color-text)" style={{ minWidth: 0 }} truncate>
          {greeting}
        </Text>
      </Group>
      <Text fz="var(--font-size-base)" maw={340} ta="center" lh={1.75} c="dimmed">
        {welcomeHint}
      </Text>
      <Stack gap={6} w="min(420px, 92%)">
        {[
          t('welcome.step.copy'),
          hotkeyEnabled
            ? t('welcome.step.hotkey').replace('{{hotkey}}', hotkey)
            : t('welcome.step.hotkey.off'),
          t('welcome.step.review'),
        ].map((step) => (
          <WelcomeStepCard key={step}>{step}</WelcomeStepCard>
        ))}
      </Stack>
      <Group gap={6} align="center" wrap="nowrap">
        <ShortcutHint combo={cycleModelCombo} />
        <Text fz="var(--font-size-sm)" c="dimmed">{t('welcome.shortcut.switchModel')}</Text>
      </Group>
    </Stack>
  );
};
