import { execFile } from 'node:child_process';

/**
 * Whether this process runs as administrator/root. A child shell inherits the token, so the agent's
 * shell tool refuses to run when elevated (proper de-elevation on Windows needs native bindings).
 * On Windows this probes `fltmc.exe`, which exits non-zero without admin; cached since a running
 * process's token cannot change.
 */
let cached: Promise<boolean> | undefined;

function probe(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return Promise.resolve(typeof process.getuid === 'function' && process.getuid() === 0);
  }
  return new Promise<boolean>((resolve) => {
    try {
      execFile('fltmc.exe', [], { windowsHide: true, timeout: 5_000 }, (err) => resolve(!err));
    } catch {
      // Cannot tell. Say NOT elevated: guessing "elevated" would disable shell for everyone the
      // moment this probe broke, and the confirmation dialog is still in front of every command.
      resolve(false);
    }
  });
}

export function isElevated(): Promise<boolean> {
  cached ??= probe();
  return cached;
}
