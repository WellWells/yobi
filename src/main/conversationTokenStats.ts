import * as fs from 'node:fs/promises';
import { extractTurnMetas } from '../shared/conversationDoc';
import { aggregateConversationUsage } from '../shared/tokenEstimate';
import type { ConversationTokenStats, TurnTokenFields } from '../shared/tokenEstimate';
import { getOutputDir, getOutputMarkdownPaths } from './files';

interface CacheEntry {
  mtimeMs: number;
  size: number;
  metas: TurnTokenFields[];
}

const cache = new Map<string, CacheEntry>();

function tokenFieldsOnly(metas: { ti?: number; to?: number; tx?: 1 }[]): TurnTokenFields[] {
  return metas.map(({ ti, to, tx }) => ({ ti, to, tx }));
}

async function readTurnFields(filePath: string): Promise<TurnTokenFields[]> {
  try {
    const stat = await fs.stat(filePath);
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.metas;
    }
    const metas = tokenFieldsOnly(extractTurnMetas(await fs.readFile(filePath, 'utf-8')));
    cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, metas });
    return metas;
  } catch {
    return [];
  }
}

export async function getConversationTokenStats(): Promise<ConversationTokenStats> {
  try {
    const paths = getOutputMarkdownPaths(await getOutputDir());
    const perConversation = await Promise.all(paths.map(readTurnFields));
    if (cache.size > paths.length) {
      const live = new Set(paths);
      for (const key of cache.keys()) {
        if (!live.has(key)) cache.delete(key);
      }
    }
    return aggregateConversationUsage(perConversation);
  } catch {
    return { conversations: 0, turns: 0, input: 0, output: 0, exact: true, uncounted: 0 };
  }
}
