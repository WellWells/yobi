import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { SectionCard, GroupHeader, SectionTitle } from '../components';
import { BotProviderCommands } from './BotProviderCommands';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useBotCommands } from '../hooks/useBotCommands';

type BotCommands = ReturnType<typeof useBotCommands>;

interface Props {
  botCommands: BotCommands;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const BotCommandsSection: React.FC<Props> = ({
  botCommands, t, showSection, isSearching, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.bots, 'bots') ? 'block' : 'none'}>
    {isSearching && <GroupHeader label={t('settings.group.bots')} />}

    <SectionCard style={{ marginBottom: sectionGap }}>
      <Group justify="space-between" align="center" gap={8} wrap="nowrap" mb={10}>
        <SectionTitle icon={<Sparkles size={15} />} label={t('settings.bot.commands.title')} mb={0} />
        <Text fz="var(--font-size-sm)" c="dimmed" style={{ flexShrink: 0 }}>
          {t('settings.bot.commands.platforms')}
        </Text>
      </Group>

      {botCommands.providerCommands && (
        <BotProviderCommands
          providerCommands={botCommands.providerCommands}
          duckaiModels={botCommands.duckaiModels}
          busy={botCommands.botCommandsBusy}
          onUpdate={(provider, patch) => { void botCommands.handleUpdateProviderCommand(provider, patch); }}
          t={t}
        />
      )}
    </SectionCard>
  </Box>
);
