import React from 'react';
import { Box, Group, Kbd, Stack, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { findModelOption } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { SHIFT_KEY_LABEL } from '../../utils/keyLabels';
import styles from '../../views/ChatView.module.css';

const WelcomeStepCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box className={styles.stepCard}>{children}</Box>
);

type GreetingSlot = 'morning' | 'afternoon' | 'evening' | 'night';

function greetingSlotFor(hour: number): GreetingSlot {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export const WelcomeScreen: React.FC<{ activeModelUrl: string }> = ({ activeModelUrl }) => {
  const { hotkey, hotkeyEnabled, userNickname } = useAppStore(
    useShallow((s) => ({
      hotkey: s.hotkey,
      hotkeyEnabled: s.hotkeyEnabled,
      userNickname: s.userNickname,
    })),
  );
  const { extraModels } = useProviderModels();
  const { t } = useI18nStore();
  const providerLabel = findModelOption(activeModelUrl, extraModels).label;
  const welcomeHint = t('welcome.hint').replace('{{provider}}', providerLabel);

  const name = userNickname.trim();
  const slot = greetingSlotFor(new Date().getHours());
  const greeting = t(`welcome.greeting.${slot}.${name ? 'named' : 'plain'}`).replace('{{name}}', () => name);

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
          // Naming a released binding would walk a new user through a key that does nothing.
          hotkeyEnabled
            ? t('welcome.step.hotkey').replace('{{hotkey}}', hotkey)
            : t('welcome.step.hotkey.off'),
          t('welcome.step.review'),
        ].map((step) => (
          <WelcomeStepCard key={step}>{step}</WelcomeStepCard>
        ))}
      </Stack>
      <Group gap={6} align="center" wrap="nowrap">
        <Kbd>{SHIFT_KEY_LABEL}</Kbd>
        <Kbd>Tab</Kbd>
        <Text fz="var(--font-size-sm)" c="dimmed">{t('welcome.shortcut.switchModel')}</Text>
      </Group>
    </Stack>
  );
};
