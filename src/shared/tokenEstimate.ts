import { estimateTokenCount } from 'tokenx';

export interface TokenUsage {
  input: number;
  output: number;
  exact: boolean;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return estimateTokenCount(text);
}

export function estimateUsage(outgoingPrompt: string, response: string): TokenUsage {
  return {
    input: estimateTokens(outgoingPrompt),
    output: estimateTokens(response),
    exact: false,
  };
}

export function sumTurnUsage(
  turns: readonly { meta: TurnTokenFields }[],
): (TokenUsage & { countedTurns: number }) | null {
  return usageFromMetas(turns.map((turn) => turn.meta));
}

export interface TurnTokenFields {
  ti?: number;
  to?: number;
  tx?: 1;
}

function usageFromMetas(
  metas: readonly TurnTokenFields[],
): (TokenUsage & { countedTurns: number }) | null {
  let input = 0;
  let output = 0;
  let exact = true;
  let countedTurns = 0;
  for (const meta of metas) {
    if (typeof meta.ti !== 'number' && typeof meta.to !== 'number') continue;
    input += meta.ti ?? 0;
    output += meta.to ?? 0;
    if (meta.tx !== 1) exact = false;
    countedTurns += 1;
  }
  return countedTurns > 0 ? { input, output, exact, countedTurns } : null;
}

export interface ConversationTokenStats {
  conversations: number;
  turns: number;
  input: number;
  output: number;
  exact: boolean;
  uncounted: number;
}

export function aggregateConversationUsage(
  conversations: readonly (readonly TurnTokenFields[])[],
): ConversationTokenStats {
  const stats: ConversationTokenStats = {
    conversations: 0, turns: 0, input: 0, output: 0, exact: true, uncounted: 0,
  };
  for (const metas of conversations) {
    const usage = usageFromMetas(metas);
    if (!usage) {
      stats.uncounted += 1;
      continue;
    }
    stats.conversations += 1;
    stats.turns += usage.countedTurns;
    stats.input += usage.input;
    stats.output += usage.output;
    if (!usage.exact) stats.exact = false;
  }
  return stats;
}

export function meanTokens(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

export function tokenMetaFields(usage: TokenUsage): { ti: number; to: number; tx?: 1 } {
  return { ti: usage.input, to: usage.output, ...(usage.exact ? { tx: 1 as const } : {}) };
}

export function formatTokenCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  if (safe < 1_000) return String(safe);
  const [scaled, suffix] = safe < 1_000_000 ? [safe / 1_000, 'k'] : [safe / 1_000_000, 'M'];
  const rounded = Math.round(scaled * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${suffix}`;
}
