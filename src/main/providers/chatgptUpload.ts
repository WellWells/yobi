import type { WebContents } from 'electron';
import { uploadViaTiles } from './tileUpload';
import { CHATGPT_ATTACHMENT_TILE_SELECTOR } from './chatgptSendScript';

const COMPOSER_SELECTORS = [
  'form[data-type="unified-composer"]',
  '#prompt-textarea',
];

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
  return uploadViaTiles(
    wc,
    {
      provider: 'chatgpt',
      dropTargets: COMPOSER_SELECTORS,
      stateScript: buildTileStateScript(),
    },
    paths,
    timeoutMs,
  );
}
