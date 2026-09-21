import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { Sparkles, Waypoints } from 'lucide-react';
import { SectionCard, SectionTitle } from '../components';
import { BotProviderCommands } from './BotProviderCommands';
import { BotBuiltinCommands } from './BotBuiltinCommands';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useBotCommands } from '../hooks/useBotCommands';

type BotCommands = ReturnType<typeof useBotCommands>;

interface Props {
  botCommands: BotCommands;
  anyBotEnabled: boolean;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const BotCommandsSection: React.FC<Props> = ({
  botCommands, anyBotEnabled, t, showSection, isSearching, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.bots, 'bots') && (anyBotEnabled || isSearching) ? 'block' : 'none'}>
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
          byokCommands={botCommands.byokCommands}
          busy={botCommands.botCommandsBusy}
          onUpdate={(provider, patch) => { void botCommands.handleUpdateProviderCommand(provider, patch); }}
          onToggleByok={(id, enabled) => { void botCommands.handleToggleByokCommand(id, enabled); }}
          t={t}
        />
      )}
    </SectionCard>

    <SectionCard style={{ marginBottom: sectionGap }}>
      <Group justify="space-between" align="center" gap={8} wrap="nowrap" mb={10}>
        <SectionTitle icon={<Waypoints size={15} />} label={t('settings.bot.builtin.title')} mb={0} />
        <Text fz="var(--font-size-sm)" c="dimmed" style={{ flexShrink: 0 }}>
          {t('settings.bot.commands.platforms')}
        </Text>
      </Group>

      {botCommands.builtinCommands && (
        <BotBuiltinCommands
          builtinCommands={botCommands.builtinCommands}
          busy={botCommands.botCommandsBusy}
          onUpdate={(key, patch) => { void botCommands.handleUpdateBuiltinCommand(key, patch); }}
          onUpdateAskTtl={(minutes) => { void botCommands.handleUpdateAskTtl(minutes); }}
          t={t}
        />
      )}
    </SectionCard>
  </Box>
);
