/*
 * Programs Yobi runs but does not ship: found on this computer, pointed at by the user, or
 * downloaded from the author's GitHub releases into Yobi's own folder. One row per program in
 * `MANAGED_TOOL_ROWS`; main adds what to download (`main/managedTools/specs.ts`), the settings card
 * renders every row the same way.
 */

export const MANAGED_TOOL_ROWS = [
  { id: 'officecli', name: 'OfficeCLI', homepage: 'https://github.com/iOfficeAI/OfficeCLI' },
] as const;

export type ManagedToolId = typeof MANAGED_TOOL_ROWS[number]['id'];

export function isManagedToolId(value: unknown): value is ManagedToolId {
  return MANAGED_TOOL_ROWS.some((row) => row.id === value);
}

/**
 * Where the copy Yobi uses came from, in the order it is looked for: a path the user chose, the
 * one Yobi downloaded (and keeps up to date), or one already installed on this computer (found
 * on PATH or in the program's usual install folder; it updates itself, Yobi never replaces it).
 */
export type ManagedToolSource = 'custom' | 'managed' | 'system';

export interface ManagedToolCopy {
  source: ManagedToolSource;
  path: string;
  version: string;
}

export interface ManagedToolProgress {
  phase: 'download' | 'verify' | 'test';
  receivedBytes: number;
  totalBytes: number;
}

export interface ManagedToolState {
  id: ManagedToolId;
  name: string;
  homepage: string;
  /** A build exists for this operating system and processor. */
  supported: boolean;
  installing: boolean;
  progress?: ManagedToolProgress;
  /** The copy Yobi runs; undefined when none is usable. */
  active?: ManagedToolCopy;
  /** The version Yobi downloaded, even while a custom path is in force. */
  managedVersion?: string;
  customPath?: string;
  /** Size of the download for this computer, for the button. */
  downloadBytes: number;
  /** The oldest version Yobi works with; an older copy on this computer is not used. */
  minVersion: string;
  lastCheckedAt?: string;
  /** The last install, update or custom-path attempt failed; raw text, for the log line. */
  installError?: string;
}
