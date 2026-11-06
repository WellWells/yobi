/**
 * The file types LINE lets you send.
 *
 * LINE only lets a file be sent when its extension is on a list its server gives the apps (the
 * setting function.file.extension.whitelist); a file with no extension may always be sent. LINE PC
 * stores its copy of that list, so a send checks against the list LINE itself uses now.
 */
import { LineError } from './errors';

const FILE_TYPES_SETTING = 'function.file.extension.whitelist';

/** The extension LINE checks: what follows the last dot, if any, lower-cased. */
export function fileExtOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/**
 * LINE's list of the extensions it lets you send, from LINE PC's stored server settings (the
 * `_setting` row's JSON); null when it is not there.
 */
export function parseAllowedFileTypes(setting: string): Set<string> | null {
  let list: unknown;
  try {
    const parsed = JSON.parse(setting) as { _sck?: { configMap?: Record<string, unknown> } } | null;
    list = parsed?._sck?.configMap?.[FILE_TYPES_SETTING];
  } catch {
    return null;
  }
  if (typeof list !== 'string') return null;
  const allowed = new Set<string>();
  for (const entry of list.split(',')) {
    const ext = entry.trim().toLowerCase();
    if (ext) allowed.add(ext);
  }
  return allowed.size > 0 ? allowed : null;
}

/** Throws INVALID_ARGUMENT naming every extension of `names` LINE does not let you send. */
export function refuseFileTypes(names: readonly string[], allowed: ReadonlySet<string>): void {
  const bad = new Set<string>();
  for (const name of names) {
    const ext = fileExtOf(name);
    if (ext && !allowed.has(ext)) bad.add(`.${ext}`);
  }
  if (bad.size === 0) return;
  const list = [...bad].sort().join(', ');
  throw new LineError('INVALID_ARGUMENT', `LINE does not let you send ${list} files, so nothing was sent; put them in a ZIP file and send that, as LINE advises`);
}

/**
 * Refuses, before anything is sent, files whose type LINE does not let you send (LINE's own advice
 * for those is a ZIP file). Without a stored list it cannot check, and says so.
 */
export function checkFileTypes(setting: string, names: readonly string[], notify: (note: string) => void): void {
  const allowed = parseAllowedFileTypes(setting);
  if (!allowed) {
    notify("note: LINE PC has not stored LINE's list of the file types it lets you send, so Yobi cannot check them; LINE may refuse some files");
    return;
  }
  refuseFileTypes(names, allowed);
}
