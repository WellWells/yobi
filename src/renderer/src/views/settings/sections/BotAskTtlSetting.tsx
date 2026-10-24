import React, { useEffect, useState } from 'react';
import { AGENT_ASK_TTL_MAX_MINUTES, AGENT_ASK_TTL_MIN_MINUTES } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { SettingField } from '../components';
import { NumberStepper } from '../NumberStepper';
import type { useBotCommands } from '../hooks/useBotCommands';

export type BotCommandsControls = ReturnType<typeof useBotCommands>;

/** The answer window clamped to what main accepts, in whole minutes. */
export function clampAskTtl(minutes: number): number {
  return Math.min(AGENT_ASK_TTL_MAX_MINUTES, Math.max(AGENT_ASK_TTL_MIN_MINUTES, Math.round(minutes)));
}

interface Props {
  botCommands: BotCommandsControls;
  t: (key: string) => string;
}

/**
 * How long the next message in a chat counts as the answer when the AI asked something back.
 * One value for every bot (it lives with the shared commands config), shown in each bot's
 * reply section; both copies read and write the same hook.
 */
export const BotAskTtlSetting: React.FC<Props> = ({ botCommands, t }) => {
  const saved = botCommands.builtinCommands?.askTtlMinutes;
  const [input, setInput] = useState(saved === undefined ? '' : String(saved));
  useEffect(() => { if (saved !== undefined) setInput(String(saved)); }, [saved]);
  if (saved === undefined) return null;

  const commit = (minutes: number): void => {
    const clamped = clampAskTtl(minutes);
    setInput(String(clamped));
    void botCommands.handleUpdateAskTtl(clamped);
  };

  return (
    <SettingField label={t('settings.bot.askTtl.label')} hint={t('settings.bot.askTtl.hint')}>
      <NumberStepper
        value={saved}
        input={input}
        onInputChange={setInput}
        onCommit={commit}
        min={AGENT_ASK_TTL_MIN_MINUTES}
        max={AGENT_ASK_TTL_MAX_MINUTES}
        unit={t('settings.bot.askTtl.minutes')}
        unitWidth={44}
        range={fillTemplate(t('settings.bot.askTtl.range'), { min: AGENT_ASK_TTL_MIN_MINUTES, max: AGENT_ASK_TTL_MAX_MINUTES })}
        decreaseLabel={t('settings.bot.askTtl.decrease')}
        increaseLabel={t('settings.bot.askTtl.increase')}
        disabled={botCommands.botCommandsBusy}
      />
    </SettingField>
  );
};
