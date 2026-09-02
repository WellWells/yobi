import { ClipboardItem, clipboard, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function checkMacosAccessibility(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function promptMacosAccessibility(): void {
  if (process.platform !== 'darwin') return;
  systemPreferences.isTrustedAccessibilityClient(true);
}

// Electron 44 replaced the clipboard module with an async, W3C-shaped API: the whole
// module is clear/has/read/write/readText/writeText and nothing else. Entries arrive as
// ClipboardItem objects whose payloads are Blobs, and an item handed back by read()
// cannot be passed to write() — it has to be rebuilt from its bytes.
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

  // If the OS refuses the write, whatever the capture left behind stays put. That is the
  // text the user selected, which is what a plain Ctrl+C would have left them with —
  // strictly better than clearing and handing back an empty clipboard.
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

export async function captureSelectedText(): Promise<string> {
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
