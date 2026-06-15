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

class GeminiUploadError extends Error {
  constructor(phase: string, detail: string) {
    super(`gemini-upload[${phase}] ${detail}`);
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
    throw new GeminiUploadError('too-many', `${paths.length} files exceeds cap ${max}`);
  }
  add(`start ${paths.length} file(s)`);

  const signedIn = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(LOGIN_SELECTOR)})`);
  if (!signedIn) throw new GeminiUploadError('not-signed-in', 'account menu not found');
  add('signed-in confirmed');

  const probe = (await wc.executeJavaScript(buildProbeScript())) as DropzoneProbe;
  if (probe.gems) throw new GeminiUploadError('gems-mode', `gem conversation: ${probe.href}`);
  if (!probe.found) throw new GeminiUploadError('dropzone-missing', 'no dropzone element');
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new GeminiUploadError('dropzone-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`dropzone @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  let attachedHere = false;
  try {
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); attachedHere = true; }
      catch (e) { throw new GeminiUploadError('debugger-attach-failed', String((e as Error)?.message ?? e)); }
    }

    const data = { items: [], files: paths, dragOperationsMask: 1 };
    const base = { x: probe.x, y: probe.y, data };
    try {
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...base });
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...base });
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...base });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('Not allowed')) throw new GeminiUploadError('file-access-denied', msg);
      throw new GeminiUploadError('dispatch-failed', msg);
    }
    add('drop dispatched');

    const deadline = Date.now() + timeoutMs;
    let count = 0;
    let consentAccepted = false;
    while (Date.now() < deadline) {
      const accepted = (await wc.executeJavaScript(CONSENT_DISMISS_SCRIPT)) as boolean;
      if (accepted && !consentAccepted) {
        consentAccepted = true;
        add('accepted first-upload consent dialog');
      }
      count = (await wc.executeJavaScript(`document.querySelectorAll(${JSON.stringify(CHIP_SELECTOR)}).length`)) as number;
      if (count >= paths.length) break;
      await sleep(300);
    }
    if (count < paths.length) {
      throw new GeminiUploadError('incomplete', `only ${count}/${paths.length} chips appeared`);
    }
    add(`chips ready ${count}/${paths.length}`);
  } finally {
    if (attachedHere && wc.debugger.isAttached()) {
      try { wc.debugger.detach(); } catch { }
    }
  }

  return log;
}
