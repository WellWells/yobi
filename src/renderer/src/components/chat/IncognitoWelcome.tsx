import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { MessageSquareDashed } from 'lucide-react';
import { useI18nStore } from '../../store/i18nStore';
import { useResolvedCombo } from '../../store/shortcutStore';
import { ShortcutRow } from './WelcomeScreen';

/** The temporary-chat header that sits directly above the composer while the chat is empty. */
export const IncognitoWelcome: React.FC = () => {
  const t = useI18nStore((s) => s.t);

  return (
    <Stack align="center" gap={14} c="dimmed" px={20} pb={12}>
      <Box
        w={56}
        h={56}
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
        <MessageSquareDashed size={26} />
      </Box>
      <Text fw={500} fz="var(--font-size-display)" lts="-0.01em" c="var(--mantine-color-text)" ta="center">
        {t('chat.tempMode.welcome.title')}
      </Text>
      <Text fz="var(--font-size-base)" maw={400} ta="center" lh={1.75} c="dimmed">
        {t('chat.tempMode.welcome.desc')}
      </Text>
    </Stack>
  );
};

/** The toggle hint that sits under the composer in an empty temporary chat. */
export const IncognitoHints: React.FC = () => {
  const tempChatCombo = useResolvedCombo('app.tempChat');

  return (
    <Group justify="center" px={20} pt={10}>
      <ShortcutRow id="app.tempChat" combo={tempChatCombo} />
    </Group>
  );
};
