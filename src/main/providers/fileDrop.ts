import type { WebContents } from 'electron';

export class UploadError extends Error {
  readonly phase: string;

  constructor(provider: string, phase: string, detail: string) {
    super(`${provider}-upload[${phase}] ${detail}`);
    this.name = 'UploadError';
    this.phase = phase;
  }
}

const UPLOAD_FAILURE_PATTERN = /^([a-z][a-z0-9]*)-upload\[([^\]]+)\]/;

export function parseUploadFailure(message: string): { provider: string; phase: string } | null {
  const match = UPLOAD_FAILURE_PATTERN.exec(message ?? '');
  if (!match) return null;
  return { provider: match[1], phase: match[2] };
}

export interface DropTargetProbe {
  found: boolean;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function buildDropTargetProbeScript(selectors: string[]): string {
  return `(function () {
    var sels = ${JSON.stringify(selectors)};
    var el = null;
    for (var i = 0; i < sels.length; i++) { el = document.querySelector(sels[i]); if (el) break; }
    if (!el) return { found: false, href: location.href, x: 0, y: 0, w: 0, h: 0 };
    var r = el.getBoundingClientRect();
    return {
      found: true,
      href: location.href,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      w: r.width,
      h: r.height
    };
  })()`;
}

export async function probeDropTarget(wc: WebContents, selectors: string[]): Promise<DropTargetProbe> {
  return (await wc.executeJavaScript(buildDropTargetProbeScript(selectors))) as DropTargetProbe;
}

export async function withTrustedFileDrop<T>(
  wc: WebContents,
  provider: string,
  point: { x: number; y: number },
  paths: string[],
  afterDrop: () => Promise<T>,
): Promise<T> {
  let attachedHere = false;
  if (!wc.debugger.isAttached()) {
    try {
      wc.debugger.attach('1.3');
      attachedHere = true;
    } catch (e) {
      throw new UploadError(provider, 'debugger-attach-failed', String((e as Error)?.message ?? e));
    }
  }

  try {
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    const base = { x: point.x, y: point.y, data };
    try {
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...base });
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...base });
      await wc.debugger.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...base });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes('Not allowed')) throw new UploadError(provider, 'file-access-denied', msg);
      throw new UploadError(provider, 'dispatch-failed', msg);
    }
    return await afterDrop();
  } finally {
    if (attachedHere && wc.debugger.isAttached()) {
      try { wc.debugger.detach(); } catch { }
    }
  }
}
