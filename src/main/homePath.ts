import * as os from 'node:os';
import * as path from 'node:path';

/** "~" and "~/x" (or "~\x") under the home folder; anything else as given. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
