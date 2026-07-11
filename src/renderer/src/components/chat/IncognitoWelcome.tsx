import React from 'react';
import { Box, Group, Kbd, Stack, Text } from '@mantine/core';
import { MessageSquareDashed } from 'lucide-react';
import { useI18nStore } from '../../store/i18nStore';
import { TEMP_CHAT_SHORTCUT_HINT } from '../../utils/keyLabels';

// Empty-state welcome for temporary chat mode — the incognito counterpart of
// WelcomeScreen, shown while the mode is on and no reply is displayed yet.
export const IncognitoWelcome: React.FC = () => {
  const { t } = useI18nStore();

  return (
    <Stack align="center" justify="center" gap={18} h="100%" c="dimmed" p="24px 20px">
      <Box
        w={64}
        h={64}
        style={{
          borderRadius: '50%',
          border: '1px dashed var(--mantine-color-violet-4)',
          background: 'color-mix(in srgb, var(--mantine-color-violet-5) 12%, transparent)',
          color: 'var(--mantine-color-violet-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MessageSquareDashed size={28} />
      </Box>
      <Text fw={600} fz="var(--font-size-3xl)" lts="-0.01em" c="var(--mantine-color-text)" ta="center">
        {t('chat.tempMode.welcome.title')}
      </Text>
      <Text fz="var(--font-size-base)" maw={400} ta="center" lh={1.75} c="dimmed">
        {t('chat.tempMode.welcome.desc')}
      </Text>
      <Group gap={6} align="center" wrap="nowrap">
        <Kbd>{TEMP_CHAT_SHORTCUT_HINT}</Kbd>
        <Text fz="var(--font-size-sm)" c="dimmed">{t('chat.tempMode.welcome.exit')}</Text>
      </Group>
    </Stack>
  );
};
