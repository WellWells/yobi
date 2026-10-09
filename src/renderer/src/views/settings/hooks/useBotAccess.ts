import { useMemo } from 'react';
import { botConnectorOptions, buildBotRoster } from '../sections/botPermissionsView';
import type { BotRoster } from '../sections/botPermissionsView';
import { useBotAccessControls } from './useBotAccessControls';
import type { BotAccessControls } from './useBotAccessControls';
import type { useLineSettings } from './useLineSettings';
import type { useMcpServers } from './useMcpServers';
import type { useTelegramSettings } from './useTelegramSettings';
import type { useUserMemory } from './useUserMemory';

interface Sources {
  telegram: ReturnType<typeof useTelegramSettings>;
  line: ReturnType<typeof useLineSettings>;
  memory: ReturnType<typeof useUserMemory>;
  mcp: ReturnType<typeof useMcpServers>;
  t: (key: string) => string;
}

export interface BotAccess {
  /** The editors under each paired list's rows. */
  telegram: BotAccessControls;
  line: BotAccessControls;
  /** Saved grants and owner marks of every paired account, for the read-only captions. */
  roster: BotRoster;
}

/**
 * The settings page's one view of bot grants: both platforms' editors and the roster the
 * built-in command rows, connector cards and memory page read. Grants come from the platform
 * snapshots, the owner mark from the memory file, the connector names from the connector list.
 */
export function useBotAccess({ telegram, line, memory, mcp, t }: Sources): BotAccess {
  const connectors = useMemo(() => botConnectorOptions(mcp.servers, t), [mcp.servers, t]);
  const botSelf = memory.snapshot?.botSelf;

  const telegramAccess = useBotAccessControls({
    platform: 'telegram',
    saved: telegram.telegramSettings?.permissions,
    reload: telegram.loadTelegramSettings,
    botSelf,
    setBotSelf: memory.setBotSelf,
    connectors,
    t,
  });
  const lineAccess = useBotAccessControls({
    platform: 'line',
    saved: line.lineSettings?.permissions,
    reload: line.loadLineSettings,
    botSelf,
    setBotSelf: memory.setBotSelf,
    connectors,
    t,
  });

  const roster = useMemo(
    () => buildBotRoster({ telegram: telegram.telegramSettings, line: line.lineSettings, botSelf, t }),
    [telegram.telegramSettings, line.lineSettings, botSelf, t],
  );

  return { telegram: telegramAccess, line: lineAccess, roster };
}
