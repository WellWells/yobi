import React from 'react';
import { Box } from '@mantine/core';
import { Sparkles, Waypoints } from 'lucide-react';
import { SectionCard, SectionTitle } from '../components';
import { BotProviderCommands } from './BotProviderCommands';
import { BotBuiltinCommands } from './BotBuiltinCommands';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useBotCommands } from '../hooks/useBotCommands';
import type { BotRoster } from './botPermissionsView';

type BotCommands = ReturnType<typeof useBotCommands>;

interface Props {
  botCommands: BotCommands;
  anyBotEnabled: boolean;
  roster: BotRoster;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'bots') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const BotCommandsSection: React.FC<Props> = ({
  botCommands, anyBotEnabled, roster, t, showSection, isSearching, sectionGap,
}) => (
  <Box display={showSection(TAG_SETS.bots, 'bots') && (anyBotEnabled || isSearching) ? 'block' : 'none'}>
    <SectionCard style={{ marginBottom: sectionGap }}>
      <SectionTitle icon={<Sparkles size={15} />} label={t('settings.bot.commands.title')} />

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
      <SectionTitle icon={<Waypoints size={15} />} label={t('settings.bot.builtin.title')} />

      {botCommands.builtinCommands && (
        <BotBuiltinCommands
          builtinCommands={botCommands.builtinCommands}
          busy={botCommands.botCommandsBusy}
          onUpdate={(key, patch) => { void botCommands.handleUpdateBuiltinCommand(key, patch); }}
          roster={roster}
          t={t}
        />
      )}
    </SectionCard>
  </Box>
);
