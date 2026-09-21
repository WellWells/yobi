import type { FlowBuildBlocker, FlowSetupNeed, SkillType } from '../../shared/types';
import { config } from '../config';

/**
 * What the app has actually been set up with. A plain snapshot rather than a live read so the
 * probe stays a pure function: the case worth testing is "Telegram is on but nobody is paired",
 * and reaching for `config` inside the check would make that case need an Electron app to reach.
 */
export interface IntegrationSnapshot {
  telegram: boolean;
  line: boolean;
  /** Paired recipients across both bots. A bot with no one paired has nowhere to send. */
  botRecipients: number;
  smtp: boolean;
  lineReader: boolean;
}

/**
 * Which one-time setup a skill needs before it can do anything. Skills not listed here work out
 * of the box — including `llm` and `research`, which drive the web UI of a provider the user is
 * already signed into and need no key of their own.
 */
const NEED_BY_SKILL: Partial<Record<SkillType, FlowSetupNeed>> = {
  bot: 'bot',
  email_send: 'email',
  line_read: 'line',
};

export function setupNeedFor(skill: SkillType): FlowSetupNeed | null {
  return NEED_BY_SKILL[skill] ?? null;
}

export function snapshotIntegrations(): IntegrationSnapshot {
  const telegram = Boolean(config.telegram?.enabled && config.telegram.botToken);
  const line = Boolean(config.line?.enabled && config.line.channelAccessToken);
  const telegramPaired = config.telegram?.pairing?.pairedUsers?.length ?? 0;
  const linePaired = config.line?.pairing?.pairedUsers?.length ?? 0;
  return {
    telegram,
    line,
    botRecipients: (telegram ? telegramPaired : 0) + (line ? linePaired : 0),
    smtp: Boolean(config.smtp?.enabled && config.smtp.host && config.smtp.user),
    lineReader: Boolean(config.lineReaderEnabled),
  };
}

/**
 * Whether the one-time setup this need covers is done.
 *
 * `bot` wants a recipient as well as a token. A bot that is connected but has nobody paired
 * fails at the last step of a flow that has already fetched, summarized and spent its LLM call —
 * which is the run the user only finds out about from an empty Telegram.
 */
export function isSetupDone(need: FlowSetupNeed, snap: IntegrationSnapshot): boolean {
  if (need === 'bot') return (snap.telegram || snap.line) && snap.botRecipients > 0;
  if (need === 'email') return snap.smtp;
  return snap.lineReader;
}

export interface ReadinessProbe {
  /** The requested skills that can run as they are. */
  ready: SkillType[];
  /** The requested skills whose integration is still missing, in the order they were requested. */
  blocked: FlowBuildBlocker[];
}

export function probeReadiness(
  skills: readonly SkillType[],
  snap: IntegrationSnapshot,
): ReadinessProbe {
  const ready: SkillType[] = [];
  const blocked: FlowBuildBlocker[] = [];
  for (const skill of skills) {
    const need = setupNeedFor(skill);
    if (need && !isSetupDone(need, snap)) blocked.push({ skill, need });
    else ready.push(skill);
  }
  return { ready, blocked };
}
