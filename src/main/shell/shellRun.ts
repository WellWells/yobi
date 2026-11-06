import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { killProcessTree } from '../youtubeDownload/processTree';
import { consoleFallbackEncoding, decodeShellOutput } from '../flow/skills/shellOutput';
import { cleanTerminalText, lastLines, OutputCapture, type OutputText } from './shellOutputText';
import type { ResolvedShell } from './defaultShell';

/*
 * Runs one chat `!` command the way the user's terminal would, then reports where it left the
 * shell. Each command is a fresh shell process; the folder carries over because the wrapper writes
 * the final working directory to a file after the command, which the next run starts in.
 *
 * On Windows 11 `-EncodedCommand` makes PowerShell serialize every error as
 * `#< CLIXML` on stderr, and `-File` names the temporary script in each error, so the script goes
 * in as `-Command` text (Node's argument quoting round-trips quotes, backslashes and newlines).
 * Profiles are not loaded (`-NoProfile`, cmd `/d`): a banner or a slow profile would land in every
 * output the model reads. stdin is closed, so a command that waits for input gets end-of-input.
 */

export interface ShellInvocation {
  file: string;
  args: string[];
  /** cmd's own quoting: the argument string goes to the process exactly as written. */
  verbatim: boolean;
  /** Its own process group, so stopping it reaches every child (macOS, Linux). */
  detached: boolean;
}

export interface WrapperFiles {
  /** Receives the working directory after the command. */
  cwd: string;
  /** Receives cmd's ERRORLEVEL, since cmd's own exit code is its last builtin's. */
  code: string;
}

function powershellLiteral(text: string): string {
  // PowerShell also closes a single-quoted string on the typographic quotes.
  return `'${text.replace(/['‘’‚‛]/g, (quote) => quote + quote)}'`;
}

function posixLiteral(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function fishLiteral(text: string): string {
  return `'${text.replace(/[\\']/g, (ch) => `\\${ch}`)}'`;
}

export function shellInvocation(shell: ResolvedShell, command: string, cwd: string, files: WrapperFiles): ShellInvocation {
  switch (shell.kind) {
    case 'pwsh':
    case 'powershell': {
      // One line ahead of the command: PowerShell's errors number the script's lines.
      const script = [
        [
          "$ProgressPreference = 'SilentlyContinue'",
          "if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }",
          `Set-Location -LiteralPath ${powershellLiteral(cwd)}`,
        ].join('; '),
        command,
        '$__yobiOk = $?',
        '$__yobiCode = $global:LASTEXITCODE',
        `try { (Get-Location).ProviderPath | Set-Content -LiteralPath ${powershellLiteral(files.cwd)} -Encoding utf8 } catch {}`,
        'if ($__yobiOk) { exit 0 }',
        'if ($__yobiCode) { exit $__yobiCode }',
        'exit 1',
      ].join('\n');
      return {
        file: shell.path,
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        verbatim: false,
        detached: false,
      };
    }
    case 'cmd': {
      // `%^errorlevel%` survives the first expansion and `call` expands it after the command ran.
      const lines = command.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const line = `${lines.join(' & ')} & call echo %^errorlevel%> "${files.code}" & cd> "${files.cwd}"`;
      return { file: shell.path, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true, detached: false };
    }
    case 'fish': {
      const script = [
        `cd ${fishLiteral(cwd)}`,
        command,
        'set __yobi_rc $status',
        `pwd > ${fishLiteral(files.cwd)} 2>/dev/null`,
        'exit $__yobi_rc',
      ].join('\n');
      return { file: shell.path, args: ['-l', '-c', script], verbatim: false, detached: true };
    }
    case 'posix': {
      const script = [
        `cd -- ${posixLiteral(cwd)}`,
        command,
        '__yobi_rc=$?',
        `pwd > ${posixLiteral(files.cwd)} 2>/dev/null`,
        'exit $__yobi_rc',
      ].join('\n');
      return { file: shell.path, args: ['-l', '-c', script], verbatim: false, detached: true };
    }
  }
}

/** The app's environment minus Electron's own switches, which would change how child programs start. */
export function commandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || /^ELECTRON_/i.test(key)) continue;
    env[key] = value;
  }
  // A git that asks for a password would wait on a console nobody can see.
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

export interface ShellRunOptions {
  shell: ResolvedShell;
  command: string;
  cwd: string;
  signal: AbortSignal;
  /** The latest lines, while it runs. */
  onProgress?: (latest: string) => void;
}

export interface ShellRunResult {
  output: OutputText;
  /** null when it was stopped or killed. */
  exitCode: number | null;
  stopped: boolean;
  /** Where the command left the shell; the starting folder when that could not be read. */
  cwdAfter: string;
}

export class ShellStartError extends Error {
  constructor(readonly shell: ResolvedShell, cause: string) {
    super(`Could not start ${shell.label} (${shell.path}): ${cause}`);
    this.name = 'ShellStartError';
  }
}

const PROGRESS_INTERVAL_MS = 150;
const PROGRESS_BYTES = 16 * 1024;
const PROGRESS_LINES = 40;

const running = new Set<ChildProcess>();

/** Ends every command still running (the app is quitting). */
export function stopAllShellRuns(): void {
  for (const child of running) {
    if (child.pid) killProcessTree(child.pid);
  }
  running.clear();
}

async function readWrapperFile(file: string, fallback: string | null): Promise<string> {
  try {
    const text = decodeShellOutput(await fs.readFile(file), fallback);
    return text.replace(/^﻿/, '').trim();
  } catch {
    return '';
  }
}

export async function runShellCommand(options: ShellRunOptions): Promise<ShellRunResult> {
  const { shell, command, cwd, signal } = options;
  const token = randomUUID();
  const files: WrapperFiles = {
    cwd: path.join(os.tmpdir(), `.yobi-shell-${token}.cwd`),
    code: path.join(os.tmpdir(), `.yobi-shell-${token}.code`),
  };
  const invocation = shellInvocation(shell, command, cwd, files);
  const fallback = await consoleFallbackEncoding();
  const capture = new OutputCapture();
  const decode = (bytes: Buffer): string => cleanTerminalText(decodeShellOutput(bytes, fallback));

  let stopped = false;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(invocation.file, invocation.args, {
        cwd,
        env: commandEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: invocation.verbatim,
        detached: invocation.detached,
      });
    } catch (err) {
      reject(new ShellStartError(shell, err instanceof Error ? err.message : String(err)));
      return;
    }
    running.add(child);

    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    const report = (): void => {
      progressTimer = null;
      options.onProgress?.(lastLines(decode(capture.latest(PROGRESS_BYTES)), PROGRESS_LINES));
    };
    const onData = (chunk: Buffer): void => {
      capture.push(chunk);
      if (options.onProgress && !progressTimer) progressTimer = setTimeout(report, PROGRESS_INTERVAL_MS);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    const stop = (): void => {
      stopped = true;
      if (child.pid) killProcessTree(child.pid);
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });

    child.once('error', (err) => {
      running.delete(child);
      signal.removeEventListener('abort', stop);
      if (progressTimer) clearTimeout(progressTimer);
      reject(new ShellStartError(shell, err.message));
    });
    child.once('close', (code) => {
      running.delete(child);
      signal.removeEventListener('abort', stop);
      if (progressTimer) clearTimeout(progressTimer);
      resolve(stopped ? null : code);
    });
  }).catch(async (err: unknown) => {
    await Promise.all([fs.rm(files.cwd, { force: true }), fs.rm(files.code, { force: true })]);
    throw err;
  });

  const [cwdAfter, codeText] = await Promise.all([
    readWrapperFile(files.cwd, fallback),
    shell.kind === 'cmd' ? readWrapperFile(files.code, fallback) : Promise.resolve(''),
  ]);
  await Promise.all([fs.rm(files.cwd, { force: true }), fs.rm(files.code, { force: true })]);

  const captured = capture.bytes();
  const cmdCode = /^-?\d+$/.test(codeText) ? Number(codeText) : null;
  return {
    output: {
      head: decode(captured.head),
      tail: captured.droppedLines > 0 ? decode(captured.tail) : '',
      droppedLines: captured.droppedLines,
    },
    exitCode: stopped ? null : (shell.kind === 'cmd' && cmdCode !== null ? cmdCode : exitCode),
    stopped,
    cwdAfter: cwdAfter || cwd,
  };
}
