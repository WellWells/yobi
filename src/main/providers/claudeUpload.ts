import type { WebContents } from 'electron';
import { uploadViaTiles } from './tileUpload';
import { CLAUDE_ATTACHMENT_TILE_SELECTOR, CLAUDE_INPUT_SELECTOR } from './claudeSendScript';

/** The drop lands on the composer's fieldset, which is what claude.ai listens on. */
const DROP_TARGET_SELECTORS = [
  `fieldset:has(${CLAUDE_INPUT_SELECTOR})`,
  CLAUDE_INPUT_SELECTOR,
];

/**
 * One tile per file, mounted within ~100-260 ms of the drop. A tile that is still uploading carries
 * `data-state="pending"` and `aria-busy="true"` (measured on a 12 MB image: ~3.4 s); both go away
 * when it is done. The `blob:` preview stays after completion, so unlike ChatGPT it says nothing.
 * Text and source files are read in the page and never show a pending phase at all.
 */
export function buildClaudeTileStateScript(): string {
  return `(function () {
    var input = document.querySelector(${JSON.stringify(CLAUDE_INPUT_SELECTOR)});
    if (!input) return { composer: false, total: 0, pending: 0 };
    var scope = (input.closest && input.closest('fieldset')) || document;
    var tiles = scope.querySelectorAll(${JSON.stringify(CLAUDE_ATTACHMENT_TILE_SELECTOR)});
    var pending = 0;
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].getAttribute('aria-busy') === 'true' || tiles[i].getAttribute('data-state') === 'pending') pending++;
    }
    return { composer: true, total: tiles.length, pending: pending };
  })()`;
}

export async function uploadFilesToClaude(
  wc: WebContents,
  paths: string[],
  timeoutMs: number,
): Promise<string[]> {
  return uploadViaTiles(
    wc,
    {
      provider: 'claude',
      dropTargets: DROP_TARGET_SELECTORS,
      stateScript: buildClaudeTileStateScript(),
    },
    paths,
    timeoutMs,
  );
}
