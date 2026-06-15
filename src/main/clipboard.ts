import { clipboard, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';

export function checkMacosAccessibility(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function promptMacosAccessibility(): void {
  if (process.platform !== 'darwin') return;
  systemPreferences.isTrustedAccessibilityClient(true);
}

interface ClipboardSnapshot {
  format: 'text' | 'image' | 'html' | 'empty';
  text?: string;
  html?: string;
  image?: Electron.NativeImage;
  rtf?: string;
}

export function backupClipboard(): ClipboardSnapshot {
  const formats = clipboard.availableFormats();

  const hasImage = formats.some((f) => f.startsWith('image/'));
  const hasHtml = formats.includes('text/html');
  const hasText = formats.includes('text/plain');
  const hasRtf = formats.includes('text/rtf');

  if (hasImage) {
    return {
      format: 'image',
      image: clipboard.readImage(),
      text: hasText ? clipboard.readText() : undefined,
      html: hasHtml ? clipboard.readHTML() : undefined,
      rtf: hasRtf ? clipboard.readRTF() : undefined,
    };
  }

  if (hasHtml || hasText) {
    return {
      format: hasHtml ? 'html' : 'text',
      text: hasText ? clipboard.readText() : undefined,
      html: hasHtml ? clipboard.readHTML() : undefined,
      rtf: hasRtf ? clipboard.readRTF() : undefined,
    };
  }

  return { format: 'empty' };
}

export function restoreClipboard(snapshot: ClipboardSnapshot): void {
  if (snapshot.format === 'empty') {
    clipboard.clear();
    return;
  }

  if (snapshot.format === 'image' && snapshot.image && !snapshot.image.isEmpty()) {
    clipboard.write({
      image: snapshot.image,
      text: snapshot.text ?? '',
      html: snapshot.html ?? '',
      rtf: snapshot.rtf ?? '',
    });
    return;
  }

  clipboard.write({
    text: snapshot.text ?? '',
    html: snapshot.html ?? '',
    rtf: snapshot.rtf ?? '',
  });
}

function pollClipboard(snapshot: ClipboardSnapshot, resolve: (v: string) => void): void {
  const check = () => clipboard.readText().trim();

  const immediate = check();
  if (immediate) {
    restoreClipboard(snapshot);
    resolve(immediate);
    return;
  }

  let attempts = 0;
  const MAX_ATTEMPTS = 150;
  const poll = setInterval(() => {
    attempts++;
    if (attempts > MAX_ATTEMPTS) {
      clearInterval(poll);
      restoreClipboard(snapshot);
      resolve('');
      return;
    }
    const text = check();
    if (text) {
      clearInterval(poll);
      restoreClipboard(snapshot);
      resolve(text);
    }
  }, 20);
}

export function captureSelectedText(): Promise<string> {
  return new Promise((resolve) => {
    const snapshot = backupClipboard();
    clipboard.clear();

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
            restoreClipboard(snapshot);
            resolve('');
            return;
          }
          const axText = stdout.trim();
          if (axText) {
            restoreClipboard(snapshot);
            resolve(axText);
            return;
          }
          pollClipboard(snapshot, resolve);
        });
        break;
      }
      case 'linux':
        execFile('xdotool', ['key', 'ctrl+c'], () => pollClipboard(snapshot, resolve));
        break;
      default:
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
            'Add-Type -A System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'],
          () => pollClipboard(snapshot, resolve),
        );
    }
  });
}
