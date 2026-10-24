import { sendLog } from '../helpers';
import { t } from '../i18n';
import { FlowUserError, localizeStepError } from '../flow/userError';
import { readPttBoard } from '../flow/skills/pttBoard';
import { RSS_BURST_CAP } from '../flow/skills/rssRead';
import { localIsoString } from '../../shared/localTime';
import type { PttBoardPreviewResult } from '../../shared/pttBoard';
import type { PttService } from './pttService';

/**
 * The newest articles a ptt_board step's fields give, read through the step's own `readPttBoard`
 * (same board check, query and order), at most as many as one run hands on, with the page it
 * reads. Nothing is kept between calls.
 */
export async function previewPttBoard(
  config: Record<string, string>,
  signal: AbortSignal,
  strings: Record<string, string>,
  service: PttService,
): Promise<PttBoardPreviewResult> {
  try {
    const { url, posts } = await readPttBoard(config, signal, service);
    if (posts.length === 0) return { status: 'empty', url };
    return {
      status: 'items',
      url,
      items: posts.slice(0, RSS_BURST_CAP).map((post) => ({
        title: post.title,
        link: post.link,
        score: String(post.score),
        date: localIsoString(new Date(post.postedAt)),
      })),
    };
  } catch (err) {
    if (signal.aborted) return { status: 'cancelled' };
    // The step's own errors say what to fix in the form; anything else is a failed read of PTT.
    if (err instanceof FlowUserError) return { status: 'error', message: localizeStepError(err, strings) };
    sendLog(`📰 [Flow] PTT board preview failed for ${config.board ?? ''}: ${err instanceof Error ? err.message : String(err)}`);
    return { status: 'error', message: t(strings, 'flow.skill.ptt_board.preview.error', { error: localizeStepError(err, strings) }) };
  }
}
