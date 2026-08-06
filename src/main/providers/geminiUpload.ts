import type { WebContents } from 'electron';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';

const DROPZONE_SELECTORS = [
  'div.xap-uploader-dropzone[file-drop-zone]',
  '[xapfileselectordropzone]',
  'chat-window-content',
];
const LOGIN_SELECTOR = 'a[gem-open-account-menu], sidenav-mavatar-footer .mavatar-image';
const CHIP_SELECTOR = 'uploader-file-preview-container uploader-file-preview';
/* Comfortably longer than a healthy attach, which renders its chip in well under a second. */
const DROP_RETRY_DELAY_MS = 5_000;
const MAX_DROP_ATTEMPTS = 5;

const CONSENT_DISMISS_SCRIPT = `(function () {
  var sels = [
    '[data-test-id="upload-image-agree-button"] button',
    'upload-image-disclaimer-dialog gem-button[type="accent"] button',
    'upload-image-disclaimer-dialog [cdkfocusinitial]'
  ];
  for (var i = 0; i < sels.length; i++) {
    var btn = document.querySelector(sels[i]);
    if (btn) { btn.click(); return true; }
  }
  return false;
})()`;

/*
 * The breadcrumb trail travels WITH the error. The caller only prints the returned log on
 * success (gemini.ts), so on failure every step this got through — signed-in, dropzone rect,
 * drop dispatched, consent accepted — used to be discarded at the one moment it is worth
 * having, leaving "0/1 chips appeared" with no way to tell a rejected drop from a renamed chip.
 */
class GeminiUploadError extends Error {
  constructor(phase: string, detail: string, trail: string[] = []) {
    const steps = trail.length > 0 ? ` — got as far as: ${trail.join(' | ')}` : '';
    super(`gemini-upload[${phase}] ${detail}${steps}`);
    this.name = 'GeminiUploadError';
  }
}

interface DropzoneProbe {
  found: boolean;
  gems: boolean;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildProbeScript(): string {
  const selectors = JSON.stringify(DROPZONE_SELECTORS);
  return `(function () {
    var sels = ${selectors};
    var el = null;
    for (var i = 0; i < sels.length; i++) { el = document.querySelector(sels[i]); if (el) break; }
    var gems = /\\/gem\\//.test(location.pathname);
    if (!el) return { found: false, gems: gems, href: location.href, x: 0, y: 0, w: 0, h: 0 };
    var r = el.getBoundingClientRect();
    return { found: true, gems: gems, href: location.href, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`;
}

export async function uploadFilesToGemini(
  wc: WebContents,
  paths: string[],
  timeoutMs: number,
): Promise<string[]> {
  const log: string[] = [];
  const t0 = Date.now();
  const add = (m: string): void => { log.push(`+${Date.now() - t0}ms ${m}`); };

  const max = PROVIDER_ATTACHMENT_POLICIES.gemini.maxFiles;
  if (paths.length > max) {
    throw new GeminiUploadError('too-many', `${paths.length} files exceeds cap ${max}`, log);
  }
  add(`start ${paths.length} file(s)`);

  const signedIn = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(LOGIN_SELECTOR)})`);
  if (!signedIn) throw new GeminiUploadError('not-signed-in', 'account menu not found', log);
  add('signed-in confirmed');

  const probe = (await wc.executeJavaScript(buildProbeScript())) as DropzoneProbe;
  if (probe.gems) throw new GeminiUploadError('gems-mode', `gem conversation: ${probe.href}`, log);
  if (!probe.found) throw new GeminiUploadError('dropzone-missing', 'no dropzone element', log);
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new GeminiUploadError('dropzone-missing', `degenerate rect ${probe.w}x${probe.h}`, log);
  }
  add(`dropzone @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  let attachedHere = false;
  try {
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); attachedHere = true; }
      catch (e) { throw new GeminiUploadError('debugger-attach-failed', String((e as Error)?.message ?? e), log); }
    }

    const data = { items: [], files: paths, dragOperationsMask: 1 };
    const base = { x: probe.x, y: probe.y, data };
    const dispatchDrop = async (): Promise<void> => {
      try {
        await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...base });
        await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...base });
        await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...base });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (msg.includes('Not allowed')) throw new GeminiUploadError('file-access-denied', msg, log);
        throw new GeminiUploadError('dispatch-failed', msg, log);
      }
    };

    /*
     * A synthetic drop is fire-and-forget: CDP reports success for dispatching the event, not for
     * anything having handled it. The drop goes out ~10ms after the composer appears, and the
     * uploader component attaches its own drop listeners separately — land in that window (or
     * while a consent dialog is swallowing input) and the event is simply lost, with nothing to
     * distinguish it from an upload still in flight. Dispatching once and then waiting made that
     * a silent two-minute stall; measured, it cost roughly one upload in three.
     *
     * So the drop is retried while no chip has appeared at all. The count guard is what keeps
     * this safe: once ANY chip exists the page did receive the drop, and re-dispatching from
     * there would attach the same file twice.
     */
    const deadline = Date.now() + timeoutMs;
    let count = 0;
    let attempts = 0;
    let nextDropAt = 0;
    let consentAccepted = false;
    while (Date.now() < deadline) {
      if (count === 0 && attempts < MAX_DROP_ATTEMPTS && Date.now() >= nextDropAt) {
        await dispatchDrop();
        attempts += 1;
        add(attempts === 1 ? 'drop dispatched' : `no chip yet — drop re-dispatched (attempt ${attempts})`);
        nextDropAt = Date.now() + DROP_RETRY_DELAY_MS;
      }
      const accepted = (await wc.executeJavaScript(CONSENT_DISMISS_SCRIPT)) as boolean;
      if (accepted && !consentAccepted) {
        consentAccepted = true;
        add('accepted first-upload consent dialog');
        // The dialog was eating input; let the next loop pass re-drop rather than wait it out.
        nextDropAt = 0;
      }
      count = (await wc.executeJavaScript(`document.querySelectorAll(${JSON.stringify(CHIP_SELECTOR)}).length`)) as number;
      if (count >= paths.length) break;
      await sleep(300);
    }
    if (count < paths.length) {
      // The elapsed time separates "waited the whole budget and nothing came" (drop rejected or
      // the chip element was renamed) from an early exit.
      add(`gave up after ${Math.round((Date.now() - t0) / 1_000)}s`);
      throw new GeminiUploadError('incomplete', `only ${count}/${paths.length} chips appeared`, log);
    }
    add(`chips ready ${count}/${paths.length}`);
  } finally {
    if (attachedHere && wc.debugger.isAttached()) {
      try { wc.debugger.detach(); } catch { }
    }
  }

  return log;
}
