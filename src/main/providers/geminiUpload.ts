import type { WebContents } from 'electron';
import { sleep } from './common';
import { PROVIDER_ATTACHMENT_POLICIES } from '../../shared/types';
import { UploadError, probeDropTarget, withTrustedFileDrop } from './fileDrop';

const PROVIDER = 'gemini';

const DROPZONE_SELECTORS = [
  'div.xap-uploader-dropzone[file-drop-zone]',
  '[xapfileselectordropzone]',
  'chat-window-content',
];
const LOGIN_SELECTOR = 'a[gem-open-account-menu], sidenav-mavatar-footer .mavatar-image';
/** Attachment chips pinned to the composer. Exported so the page-reuse gate can refuse a
 *  composer that is still holding the previous run's files. */
export const GEMINI_CHIP_SELECTOR = 'uploader-file-preview-container uploader-file-preview';

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

function isGemsConversation(href: string): boolean {
  try {
    return /\/gem\//.test(new URL(href).pathname);
  } catch {
    return false;
  }
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
    throw new UploadError(PROVIDER, 'too-many', `${paths.length} files exceeds cap ${max}`);
  }
  add(`start ${paths.length} file(s)`);

  const signedIn = await wc.executeJavaScript(`!!document.querySelector(${JSON.stringify(LOGIN_SELECTOR)})`);
  if (!signedIn) throw new UploadError(PROVIDER, 'not-signed-in', 'account menu not found');
  add('signed-in confirmed');

  const probe = await probeDropTarget(wc, DROPZONE_SELECTORS);
  if (isGemsConversation(probe.href)) throw new UploadError(PROVIDER, 'gems-mode', `gem conversation: ${probe.href}`);
  if (!probe.found) throw new UploadError(PROVIDER, 'dropzone-missing', 'no dropzone element');
  if (!(probe.w > 0 && probe.h > 0)) {
    throw new UploadError(PROVIDER, 'dropzone-missing', `degenerate rect ${probe.w}x${probe.h}`);
  }
  add(`dropzone @ ${Math.round(probe.x)},${Math.round(probe.y)} (${Math.round(probe.w)}x${Math.round(probe.h)})`);

  await withTrustedFileDrop(wc, PROVIDER, probe, paths, async () => {
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
      count = (await wc.executeJavaScript(`document.querySelectorAll(${JSON.stringify(GEMINI_CHIP_SELECTOR)}).length`)) as number;
      if (count >= paths.length) break;
      await sleep(300);
    }
    if (count < paths.length) {
      throw new UploadError(PROVIDER, 'incomplete', `only ${count}/${paths.length} chips appeared`);
    }
    add(`chips ready ${count}/${paths.length}`);
  });

  return log;
}
