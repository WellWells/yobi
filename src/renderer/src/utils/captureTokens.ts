import { formatTokenCount, sumTurnUsage, type TokenUsage } from '../../../shared/tokenEstimate';
import type { TurnMeta } from '../../../shared/conversationDoc';

type Translate = (key: string) => string;

function label(usage: TokenUsage, key: string, t: Translate): string {
  const prefix = usage.exact ? '' : '~';
  return `${prefix}${t(key).replace('{{total}}', formatTokenCount(usage.input + usage.output))}`;
}

export function turnTokenLabel(meta: TurnMeta, t: Translate): string | undefined {
  if (typeof meta.ti !== 'number' && typeof meta.to !== 'number') return undefined;
  return label({ input: meta.ti ?? 0, output: meta.to ?? 0, exact: meta.tx === 1 }, 'chat.tokens.label', t);
}

export function totalTokenLabel(turns: readonly { meta: TurnMeta }[], t: Translate): string | undefined {
  const usage = sumTurnUsage(turns);
  return usage ? label(usage, 'chat.tokens.conversationTotal', t) : undefined;
}
