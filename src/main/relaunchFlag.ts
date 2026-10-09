/**
 * Added to the command line when Yobi restarts itself (the restart_app step, Telegram /restart,
 * factory reset), so a flow that runs at startup does not run again on that restart: one whose
 * own last step restarts Yobi would otherwise loop for ever.
 */
export const RELAUNCH_FLAG = '--yobi-relaunched';

export function relaunchArgs(argv: readonly string[] = process.argv): string[] {
  return [...argv.slice(1).filter((arg) => arg !== RELAUNCH_FLAG), RELAUNCH_FLAG];
}

export function launchedByRelaunch(argv: readonly string[] = process.argv): boolean {
  return argv.includes(RELAUNCH_FLAG);
}
