import React from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { findModelOption } from '../../config/models';
import styles from '../../views/ChatView.module.css';

const WelcomeStepCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box className={styles.stepCard}>{children}</Box>
);

export const WelcomeScreen: React.FC<{ activeModelUrl: string }> = ({ activeModelUrl }) => {
  const { hotkey, duckaiModels } = useAppStore(
    useShallow((s) => ({ hotkey: s.hotkey, duckaiModels: s.duckaiModels })),
  );
  const { t } = useI18nStore();
  const providerLabel = findModelOption(activeModelUrl, duckaiModels).label;
  const welcomeHint = t('welcome.hint').replace('{{provider}}', providerLabel);

  return (
    <Stack align="center" justify="center" gap={18} h="100%" c="dimmed" p="24px 20px">
      <Text fw={700} fz="var(--font-size-3xl)" lts="-0.01em" c="var(--mantine-color-text)">
        Yobi
      </Text>
      <Text fz="var(--font-size-base)" maw={340} ta="center" lh={1.75} c="dimmed">
        {welcomeHint}
      </Text>
      <Stack gap={6} w="min(420px, 92%)">
        {[
          t('welcome.step.copy'),
          t('welcome.step.hotkey').replace('{{hotkey}}', hotkey),
          t('welcome.step.review'),
        ].map((step) => (
          <WelcomeStepCard key={step}>{step}</WelcomeStepCard>
        ))}
      </Stack>
    </Stack>
  );
};
