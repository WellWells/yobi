import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ComposerEditorEvent } from '../shared/types';

/*
 * Ctrl+G in the message box: the draft goes to a temp file, the user's editor opens it, and what
 * they save comes back. Waiting for the editor to exit is not enough from a GUI app: `code` without
 * `--wait`, macOS `open` and `xdg-open` hand the file to a running app and return at once, and an
 * already-open Windows 11 Notepad takes it as a tab while the started process lingers. So the file
 * is also watched: every save reaches the composer as it lands, and the exit only says "done".
 */

export const EDITOR_FILE_NAME = 'yobi-prompt.md';
/** A launcher gone within this long handed the file to an app that was already running. */
export const EDITOR_HANDOFF_MS = 1_500;
export const EDITOR_SAVE_DEBOUNCE_MS = 150;

// Programs that draw inside a terminal. A GUI app has no terminal to give them, except on
// Windows, where a console window is created for them on demand.
const TERMINAL_EDITORS = new Set([
  'vi', 'vim', 'nvim', 'nano', 'pico', 'micro', 'hx', 'helix', 'kak', 'ne', 'joe', 'jed', 'mg',
  'ed', 'ex', 'vis', 'mcedit',
]);

export interface EditorLaunch {
  /** The executable, or the whole command line when `shell` is set. */
  command: string;
  args: string[];
  shell: boolean;
  /** Needs a console window to draw in. */
  terminal: boolean;
}

/** `"C:\Program Files\Vim\vim.exe" -f` → `vim`. */
export function editorCommandName(commandLine: string): string {
  const trimmed = commandLine.trim();
  const first = trimmed.startsWith('"') ? trimmed.slice(1).split('"')[0] : trimmed.split(/\s+/)[0];
  return (first.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

export function isTerminalEditor(commandLine: string): boolean {
  const name = editorCommandName(commandLine);
  if (name === 'emacs') return /\s(-nw|--no-window-system)(\s|$)/.test(commandLine);
  return TERMINAL_EDITORS.has(name);
}

export function quoteShellArg(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `"${value}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** What the setting resolved to. */
export type EditorChoice =
  /** `VISUAL`, then `EDITOR` — the variables Claude Code and git read — then the system editor. */
  | { kind: 'auto' }
  | { kind: 'system' }
  /** The user's own command line. */
  | { kind: 'command'; command: string }
  /** An editor found on this machine. */
  | { kind: 'program'; path: string; args: readonly string[] };

/**
 * Command lines run through the shell so `code --wait` works as written. A terminal editor is only
 * used on Windows; elsewhere the platform's own text editor stands in.
 */
export function resolveEditorLaunch(
  choice: EditorChoice,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  file: string,
): EditorLaunch {
  if (choice.kind === 'program') {
    // A Windows batch launcher (code.cmd) only runs through the shell.
    if (platform === 'win32' && /\.(cmd|bat)$/i.test(choice.path)) {
      const command = [choice.path, ...choice.args, file].map((arg) => quoteShellArg(arg, platform)).join(' ');
      return { command, args: [], shell: true, terminal: false };
    }
    return { command: choice.path, args: [...choice.args, file], shell: false, terminal: false };
  }
  const configured = choice.kind === 'command'
    ? choice.command.trim()
    : choice.kind === 'auto' ? (env.VISUAL?.trim() || env.EDITOR?.trim()) : '';
  if (configured) {
    const terminal = isTerminalEditor(configured);
    if (!terminal || platform === 'win32') {
      return { command: `${configured} ${quoteShellArg(file, platform)}`, args: [], shell: true, terminal };
    }
  }
  if (platform === 'win32') return { command: 'notepad.exe', args: [file], shell: false, terminal: false };
  if (platform === 'darwin') return { command: 'open', args: ['-t', file], shell: false, terminal: false };
  return { command: 'xdg-open', args: [file], shell: false, terminal: false };
}

/**
 * An app opened from the Finder gets PATH=/usr/bin:/bin:/usr/sbin:/sbin — without the folders
 * where Homebrew and the editors' "install command" put `code`, `subl` and `zed`. A command that
 * works in Terminal would not be found from Yobi otherwise.
 */
export const MAC_EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin'] as const;

export function launchEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  if (platform !== 'darwin') return env;
  const dirs = (env.PATH ?? '').split(':').filter(Boolean);
  const missing = MAC_EXTRA_PATH.filter((dir) => !dirs.includes(dir));
  return missing.length > 0 ? { ...env, PATH: [...dirs, ...missing].join(':') } : env;
}

/** What the composer receives: no BOM, `\n` line ends, no trailing newline an editor appended. */
export function normalizeEditedText(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

export type EditorEvent = ComposerEditorEvent;

export interface EditorSession {
  readonly file: string;
  isOpen(): boolean;
  /** Stops listening, removes the file, and returns its text if the composer has not seen it yet. */
  finish(): Promise<string | null>;
}

export interface EditorSessionDeps {
  choice?: EditorChoice;
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  tmpRoot?: string;
  now?: () => number;
  debounceMs?: number;
}

export async function openEditorSession(
  text: string,
  onEvent: (event: EditorEvent) => void,
  deps: EditorSessionDeps = {},
): Promise<EditorSession> {
  const now = deps.now ?? Date.now;
  const dir = await fs.mkdtemp(path.join(deps.tmpRoot ?? os.tmpdir(), 'yobi-prompt-'));
  const file = path.join(dir, EDITOR_FILE_NAME);
  await fs.writeFile(file, text, 'utf8');

  let last = normalizeEditedText(text);
  let ended = false;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Reads run one at a time, so the final read on exit cannot race a save's read for `last`.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
  };

  const readChange = async (): Promise<string | null> => {
    const current = await fs.readFile(file, 'utf8').then(normalizeEditedText, () => null);
    if (current === null || current === last) return null;
    last = current;
    return current;
  };

  const stop = (): void => {
    ended = true;
    if (debounce) clearTimeout(debounce);
    debounce = null;
    watcher?.close();
    watcher = null;
  };
  const removeDir = (): Promise<void> => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);

  const end = async (): Promise<string | null> => {
    if (ended) return null;
    stop();
    const changed = await serial(readChange);
    await removeDir();
    return changed;
  };
  const fail = async (detail: string): Promise<void> => {
    if (ended) return;
    stop();
    await removeDir();
    onEvent({ kind: 'failed', detail });
  };

  try {
    // The folder is ours alone, so any event in it is worth a read; the text comparison
    // decides. Editors that save by writing a sibling and renaming it never touch the name.
    watcher = watch(dir, () => {
      if (ended) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void serial(async () => {
          if (ended) return;
          const changed = await readChange();
          if (changed !== null) onEvent({ kind: 'saved', text: changed });
        });
      }, deps.debounceMs ?? EDITOR_SAVE_DEBOUNCE_MS);
    });
    // Without the watcher, saves arrive on exit or "done" instead of as they land.
    watcher.on('error', () => { watcher?.close(); watcher = null; });
  } catch {
    watcher = null;
  }

  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const launch = resolveEditorLaunch(deps.choice ?? { kind: 'auto' }, env, platform, file);
  const startedAt = now();
  let child: ChildProcess;
  try {
    child = (deps.spawn ?? spawn)(launch.command, launch.args, {
      shell: launch.shell,
      env: launchEnv(env, platform),
      // A terminal editor on Windows gets its own console window. Hide only the shell's console:
      // Notepad obeys SW_HIDE, so launched directly with it, it would run with no window at all.
      detached: launch.terminal,
      windowsHide: launch.shell && !launch.terminal,
      stdio: 'ignore',
    });
  } catch (err) {
    stop();
    await removeDir();
    throw err;
  }
  child.on('error', (err) => { void fail(err.message); });
  child.on('exit', (code) => {
    if (ended) return;
    if (now() - startedAt < EDITOR_HANDOFF_MS) {
      if (code !== 0) void fail(`${launch.command} exited with code ${code}`);
      // Handed to an app that was already running: saves keep arriving, "done" ends it.
      return;
    }
    void end().then((changed) => onEvent({ kind: 'closed', text: changed }));
  });

  return {
    file,
    isOpen: () => !ended,
    finish: end,
  };
}
