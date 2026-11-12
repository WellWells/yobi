import type { TriggerConfig } from './types';

/**
 * The flow's own bot command (no slash), which its bot steps' buttons run again; '' when no
 * trigger is a bot command, and then no platform gets the buttons at all.
 */
export function flowBotCommand(triggers: readonly (TriggerConfig | undefined)[]): string {
  const trigger = triggers.find((t) => t?.type === 'bot' && (t.botCommand ?? '').trim());
  return (trigger?.botCommand ?? '').trim().replace(/^\//, '');
}
