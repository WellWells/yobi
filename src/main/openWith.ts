import { spawn } from 'node:child_process';

function launchDetached(command: string, args: string[], verbatim = false): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
  child.on('error', () => {});
  child.unref();
}

/**
 * Lets the user pick the app: the OS "Open with" chooser on Windows. macOS has no chooser
 * a process can raise, so the file goes to the default text editor instead. Returns false
 * where neither exists (Linux), so the caller can hide the entry.
 */
export function openWithChooser(filePath: string): boolean {
  if (process.platform === 'win32') {
    // rundll32 hands everything after the comma to OpenAs_RunDLL as one raw string, so the
    // path rides unquoted and Node must not add quotes of its own.
    launchDetached('rundll32.exe', [`shell32.dll,OpenAs_RunDLL ${filePath}`], true);
    return true;
  }
  if (process.platform === 'darwin') {
    launchDetached('open', ['-t', filePath]);
    return true;
  }
  return false;
}
