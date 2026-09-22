import type { WebContents } from 'electron';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';
import type { Provider } from '../../shared/types';
import { UploadError, probeDropTarget, withTrustedFileDrop } from './fileDrop';

const TILE_APPEAR_TIMEOUT_MS = 10_000;
const POLL_MS = 300;

/** What a provider's tile-state script must report back from the page. */
export interface TileState {
  composer: boolean;
  total: number;
  pending: number;
}

export interface TileUploadSpec {
  provider: Provider;
  /** Tried in order; the first one with a non-degenerate rect receives the drop. */
  dropTargets: string[];
  /** Page script evaluating to a `TileState`. Provider-specific: the DOM signals differ. */
  stateScript: string;
}

/**
 * Claude and ChatGPT both accept a trusted file drop on the composer and then mount one tile per
 * file. What differs is only where the drop lands and how a tile says "still uploading"; the
 * wait loop — baseline, appearance deadline, two settled polls, failure classification — is the
 * same, and drifting the two copies apart is how an upload silently starts reporting success
 * before the files are attached.
 */
export async function uploadViaTiles(
  wc: WebContents,
  spec: TileUploadSpec,
  paths: string[],
  timeoutMs: number,
): Promise<string[]> {
  const { provider, dropTargets, stateScript } = spec;
  const log: string[] = [];
  const t0 = Date.now();
  const add = (m: string): void => { log.push(`+${Date.now() - t0}ms ${m}`); };

  const max = PROVIDER_ATTACHMENT_POLICIES[provider].maxFiles;
  if (paths.length > max) {
    throw new UploadError(provider, 'too-many', `${paths.length} files exceeds cap ${max}`);
  }
  add(`start ${paths.length} file(s)`);

  const probe = await probeDropTarget(wc, dropTargets);
  if (!probe.found) throw new UploadError(provider, 'composer-missing', `no composer at ${probe.href}`);
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new UploadError(provider, 'composer-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`composer @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  const before = (await wc.executeJavaScript(stateScript)) as TileState;
  const baseline = before.total;
  if (baseline > 0) add(`composer already held ${baseline} tile(s)`);
  const expected = baseline + paths.length;

  await withTrustedFileDrop(wc, provider, probe, paths, async () => {
    add('drop dispatched');

    const deadline = Date.now() + timeoutMs;
    const appearBy = Date.now() + TILE_APPEAR_TIMEOUT_MS;
    let state: TileState = before;
    let settledPolls = 0;

    while (Date.now() < deadline) {
      state = (await wc.executeJavaScript(stateScript)) as TileState;
      if (!state.composer) throw new UploadError(provider, 'composer-missing', 'composer vanished mid-upload');

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
          provider,
          'rejected',
          `only ${state.total - baseline}/${paths.length} file(s) accepted at the dropzone`,
        );
      }
      await sleep(POLL_MS);
    }

    throw new UploadError(
      provider,
      'incomplete',
      `${state.total - baseline}/${paths.length} tiles, ${state.pending} still uploading`,
    );
  });

  return log;
}
