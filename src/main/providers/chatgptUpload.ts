import type { WebContents } from 'electron';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';
import { UploadError, probeDropTarget, withTrustedFileDrop } from './fileDrop';
import { CHATGPT_ATTACHMENT_TILE_SELECTOR } from './chatgptSendScript';

const PROVIDER = 'chatgpt';

const COMPOSER_SELECTORS = [
  'form[data-type="unified-composer"]',
  '#prompt-textarea',
];

const TILE_APPEAR_TIMEOUT_MS = 10_000;
const POLL_MS = 300;

interface TileState {
  composer: boolean;
  total: number;
  pending: number;
}

const FIND_COMPOSER_JS = `function chatgptComposer() {
  var form = document.querySelector('form[data-type="unified-composer"]');
  if (form) return form;
  var box = document.querySelector('#prompt-textarea');
  return box ? box.closest('form') : null;
}`;

export const CHATGPT_TILE_PENDING_JS = `function chatgptTilePending(tile) {
  if (tile.querySelector('[class*="cursor-wait"]')) return true;
  if (tile.querySelector('img[src^="blob:"]')) return true;
  var rings = tile.querySelectorAll('circle[stroke-dasharray]');
  for (var i = 0; i < rings.length; i++) {
    var box = rings[i].getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return true;
  }
  return false;
}`;

export function buildTileStateScript(): string {
  return `(function () {
    ${FIND_COMPOSER_JS}
    ${CHATGPT_TILE_PENDING_JS}
    var composer = chatgptComposer();
    if (!composer) return { composer: false, total: 0, pending: 0 };
    var tiles = composer.querySelectorAll(${JSON.stringify(CHATGPT_ATTACHMENT_TILE_SELECTOR)});
    var pending = 0;
    for (var i = 0; i < tiles.length; i++) {
      if (chatgptTilePending(tiles[i])) pending++;
    }
    return { composer: true, total: tiles.length, pending: pending };
  })()`;
}

export async function uploadFilesToChatgpt(
  wc: WebContents,
  paths: string[],
  timeoutMs: number,
): Promise<string[]> {
  const log: string[] = [];
  const t0 = Date.now();
  const add = (m: string): void => { log.push(`+${Date.now() - t0}ms ${m}`); };

  const max = PROVIDER_ATTACHMENT_POLICIES.chatgpt.maxFiles;
  if (paths.length > max) {
    throw new UploadError(PROVIDER, 'too-many', `${paths.length} files exceeds cap ${max}`);
  }
  add(`start ${paths.length} file(s)`);

  const probe = await probeDropTarget(wc, COMPOSER_SELECTORS);
  if (!probe.found) throw new UploadError(PROVIDER, 'composer-missing', `no composer at ${probe.href}`);
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new UploadError(PROVIDER, 'composer-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`composer @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  const stateScript = buildTileStateScript();
  const before = (await wc.executeJavaScript(stateScript)) as TileState;
  const baseline = before.total;
  if (baseline > 0) add(`composer already held ${baseline} tile(s)`);
  const expected = baseline + paths.length;

  await withTrustedFileDrop(wc, PROVIDER, probe, paths, async () => {
    add('drop dispatched');

    const deadline = Date.now() + timeoutMs;
    const appearBy = Date.now() + TILE_APPEAR_TIMEOUT_MS;
    let state: TileState = before;
    let settledPolls = 0;

    while (Date.now() < deadline) {
      state = (await wc.executeJavaScript(stateScript)) as TileState;
      if (!state.composer) throw new UploadError(PROVIDER, 'composer-missing', 'composer vanished mid-upload');

      if (state.total >= expected && state.pending === 0) {
        settledPolls += 1;
        if (settledPolls >= 2) {
          add(`all ${paths.length} attachment(s) uploaded`);
          return;
        }
      } else {
        settledPolls = 0;
      }

      if (state.total < expected && Date.now() > appearBy) {
        throw new UploadError(
          PROVIDER,
          'rejected',
          `only ${state.total - baseline}/${paths.length} file(s) accepted at the dropzone`,
        );
      }
      await sleep(POLL_MS);
    }

    throw new UploadError(
      PROVIDER,
      'incomplete',
      `${state.total - baseline}/${paths.length} tiles, ${state.pending} still uploading`,
    );
  });

  return log;
}
