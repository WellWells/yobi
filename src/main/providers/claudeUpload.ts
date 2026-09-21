import type { WebContents } from 'electron';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';
import { UploadError, probeDropTarget, withTrustedFileDrop } from './fileDrop';
import { CLAUDE_ATTACHMENT_TILE_SELECTOR, CLAUDE_INPUT_SELECTOR } from './claudeSendScript';

const PROVIDER = 'claude';

/** The drop lands on the composer's fieldset, which is what claude.ai listens on. */
const DROP_TARGET_SELECTORS = [
  `fieldset:has(${CLAUDE_INPUT_SELECTOR})`,
  CLAUDE_INPUT_SELECTOR,
];

const TILE_APPEAR_TIMEOUT_MS = 10_000;
const POLL_MS = 300;

interface TileState {
  composer: boolean;
  total: number;
  pending: number;
}

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
  const log: string[] = [];
  const t0 = Date.now();
  const add = (m: string): void => { log.push(`+${Date.now() - t0}ms ${m}`); };

  const max = PROVIDER_ATTACHMENT_POLICIES.claude.maxFiles;
  if (paths.length > max) {
    throw new UploadError(PROVIDER, 'too-many', `${paths.length} files exceeds cap ${max}`);
  }
  add(`start ${paths.length} file(s)`);

  const probe = await probeDropTarget(wc, DROP_TARGET_SELECTORS);
  if (!probe.found) throw new UploadError(PROVIDER, 'composer-missing', `no composer at ${probe.href}`);
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new UploadError(PROVIDER, 'composer-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`composer @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  const stateScript = buildClaudeTileStateScript();
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
