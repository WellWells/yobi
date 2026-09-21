import { execFile } from 'node:child_process';

/**
 * Whether THIS process is running with administrator / root rights.
 *
 * It matters because a child shell inherits the parent's token: if the user happened to start the
 * app elevated, every command the agent runs is elevated too, and the whole class of damage that
 * needs admin — services, scheduled tasks under SYSTEM, replacing a binary in System32, exporting
 * a credential hive — comes into reach without anything in the app asking for it.
 *
 * The agent's shell tool refuses to run at all in that case. Refusing is chosen over DE-elevating
 * because dropping privileges properly on Windows needs `CreateRestrictedToken` /
 * `CreateProcessAsUser` through native bindings, and a de-elevation that half works is worse than
 * an honest refusal: it looks like a boundary and is not one.
 *
 * Detection is `fltmc.exe`, which exits non-zero without admin. Measured at ~25 ms, and cached for
 * the life of the process because a token cannot change under a running process.
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

/** Exported for the test suite. */
export function resetElevationCache(): void {
  cached = undefined;
}
