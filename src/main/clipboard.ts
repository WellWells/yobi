import { ClipboardItem, clipboard, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function checkMacosAccessibility(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function promptMacosAccessibility(): void {
  if (process.platform !== 'darwin') return;
  systemPreferences.isTrustedAccessibilityClient(true);
}

// Electron's clipboard is async and W3C-shaped: entries are ClipboardItems holding Blobs, and an
// item returned by read() cannot be passed to write(); it has to be rebuilt from its bytes.
const RESTORABLE_TYPES: readonly string[] = [
  'text/plain',
  'text/html',
  'text/rtf',
  'image/png',
  'text/uri-list',
];

const POLL_INTERVAL_MS = 20;
const POLL_MAX_ATTEMPTS = 150;

interface ClipboardEntry {
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
}

interface ClipboardSnapshot {
  items: ClipboardEntry[][];
}

export async function readClipboardItems(): Promise<Electron.ClipboardItem[]> {
  try {
    return await clipboard.read();
  } catch {
    return [];
  }
}

async function readClipboardText(): Promise<string> {
  try {
    return await clipboard.readText();
  } catch {
    return '';
  }
}

// getType() resolves to a Blob for every type except 'electron application/bookmark',
// which resolves to a plain object — hence the instanceof guard rather than a cast.
export async function clipboardBytes(
  item: Electron.ClipboardItem,
  type: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const payload = await item.getType(type);
    if (!(payload instanceof Blob)) return null;
    return new Uint8Array(await payload.arrayBuffer());
  } catch {
    return null;
  }
}

function clipboardBlob(bytes: Uint8Array<ArrayBuffer>, type: string): Blob {
  return new Blob([bytes], { type });
}

// Only the types we know survive a write() round-trip are snapshotted. The OLE
// bookkeeping formats Windows attaches ('DataObject', 'Ole Private Data') are not
// meaningful to hand back, and restoring them is untested.
export async function backupClipboard(): Promise<ClipboardSnapshot> {
  const items: ClipboardEntry[][] = [];
  for (const item of await readClipboardItems()) {
    const entries: ClipboardEntry[] = [];
    for (const type of item.types) {
      if (!RESTORABLE_TYPES.includes(type)) continue;
      const bytes = await clipboardBytes(item, type);
      if (bytes) entries.push({ type, bytes });
    }
    if (entries.length > 0) items.push(entries);
  }
  return { items };
}

export async function restoreClipboard(snapshot: ClipboardSnapshot): Promise<void> {
  if (snapshot.items.length === 0) {
    clipboard.clear();
    return;
  }

  const items = snapshot.items.map((entries) => new ClipboardItem(
    Object.fromEntries(entries.map((entry) => [entry.type, clipboardBlob(entry.bytes, entry.type)])),
  ));

  // If the OS refuses the write, keep the captured selection rather than clearing the clipboard.
  try {
    await clipboard.write(items);
  } catch {
    return;
  }
}

async function pollClipboard(finish: (value: string) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
    const text = (await readClipboardText()).trim();
    if (text) {
      await finish(text);
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  await finish('');
}

/**
 * Undoes a provider's own "Copy" click at the end of a task, and nothing else: the snapshot is
 * restored only while the clipboard still holds the answer just read, so anything the user copied
 * in the meantime is never overwritten. Normally `interceptCopy` keeps the OS clipboard out of it
 * and this does nothing.
 */
export async function restoreClipboardAfterTask(
  snapshot: ClipboardSnapshot,
  providerAnswer: string,
): Promise<boolean> {
  const answer = providerAnswer.trim();
  if (!answer) return false;
  const current = (await readClipboardText()).trim();
  if (!current || current !== answer) return false;
  await restoreClipboard(snapshot);
  return true;
}

/** A digest of everything restorable on the clipboard: equal digests mean nothing was copied in between. */
export async function clipboardFingerprint(): Promise<string> {
  const hash = createHash('sha256');
  for (const entries of (await backupClipboard()).items) {
    for (const { type, bytes } of entries) hash.update(`${type}\0`).update(bytes).update('\0');
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Puts a hotkey task's answer on the clipboard — select, press, paste is the loop the hotkey
 * exists for. Skipped when the user has copied something else since the press: a task can run
 * for minutes, and replacing that copy is the loss `restoreClipboardAfterTask` guards against.
 * A provider "Copy" click that leaked through still counts as untouched, since it holds the answer.
 */
export async function handAnswerToClipboard(
  fingerprintAtPress: string,
  answer: string,
  providerAnswer: string,
): Promise<boolean> {
  const text = answer.trim();
  if (!text) return false;
  const leaked = providerAnswer.trim();
  const untouched = await clipboardFingerprint() === fingerprintAtPress
    || (leaked !== '' && (await readClipboardText()).trim() === leaked);
  if (!untouched) return false;
  try {
    await clipboard.writeText(text);
  } catch {
    return false;
  }
  return true;
}

let captureInFlight: Promise<string> | null = null;

export function isClipboardCaptureInFlight(): boolean {
  return captureInFlight !== null;
}

/**
 * Captures the current selection, leaving the clipboard as it found it.
 *
 * Only one capture runs at a time: polling outlasts the hotkey debounce, and an overlapping capture
 * would snapshot a clipboard the first had already cleared and send the old clipboard as the
 * selection. An overlapping press is dropped; the running capture is the one the user awaits.
 */
export function captureSelectedText(): Promise<string> {
  if (captureInFlight) return Promise.resolve('');
  const run = runCapture();
  captureInFlight = run;
  return run.finally(() => {
    captureInFlight = null;
  });
}

async function runCapture(): Promise<string> {
  const snapshot = await backupClipboard();
  clipboard.clear();

  return new Promise((resolve) => {
    const finish = async (value: string): Promise<void> => {
      await restoreClipboard(snapshot);
      resolve(value);
    };

    switch (process.platform) {
      case 'darwin': {
        const script = [
          'tell application "System Events"',
          '    set frontProc to first application process whose frontmost is true',
          '    try',
          '        set sel to value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement" of frontProc)',
          '        if sel is not "" then return sel',
          '    end try',
          '    tell frontProc to keystroke "c" using {command down}',
          '    return ""',
          'end tell',
        ].join('\n');

        execFile('/usr/bin/osascript', ['-e', script], (err, stdout) => {
          if (err) {
            void finish('');
            return;
          }
          const axText = stdout.trim();
          if (axText) {
            void finish(axText);
            return;
          }
          void pollClipboard(finish);
        });
        break;
      }
      case 'linux':
        execFile('xdotool', ['key', 'ctrl+c'], () => void pollClipboard(finish));
        break;
      default:
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
            'Add-Type -A System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'],
          () => void pollClipboard(finish),
        );
    }
  });
}
