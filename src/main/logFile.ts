import { app } from 'electron';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATIONS = 2;
const FLUSH_INTERVAL_MS = 1_000;

const LOG_FILE_NAME = 'yobi.log';
const LOG_DIR_NAME = 'logs';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local-time stamp used at the head of every line in the log file. */
export function fileStamp(now: Date): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return `${date} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

const IS_TEST = Boolean(process.env.VITEST);

export interface LogFileSink {
  append(line: string): void;
  flush(): Promise<void>;
  flushSync(): void;
  readonly dir: string;
  readonly file: string;
}

export interface LogFileSinkOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
  keep?: number;
  flushIntervalMs?: number;
}

export function createLogFileSink({
  dir,
  fileName = LOG_FILE_NAME,
  maxBytes = MAX_FILE_BYTES,
  keep = KEEP_ROTATIONS,
  flushIntervalMs = FLUSH_INTERVAL_MS,
}: LogFileSinkOptions): LogFileSink {
  const file = path.join(dir, fileName);
  let pending: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let disabled = false;
  let size = -1;

  function disable(err: unknown): void {
    if (disabled) return;
    disabled = true;
    pending = [];
    console.error('[log] file logging disabled:', err instanceof Error ? err.message : err);
  }

  function rotateSync(): void {
    for (let i = keep; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (!fs.existsSync(from)) continue;
      fs.rmSync(to, { force: true });
      fs.renameSync(from, to);
    }
    size = 0;
  }

  function takeChunk(): string | null {
    if (disabled || pending.length === 0) return null;
    const chunk = `${pending.join('\n')}\n`;
    pending = [];
    return chunk;
  }

  function prepare(chunk: string): void {
    fs.mkdirSync(dir, { recursive: true });
    if (size < 0) {
      size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    }
    if (size > 0 && size + Buffer.byteLength(chunk, 'utf8') > maxBytes) {
      rotateSync();
    }
  }

  function clearTimer(): void {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  async function drain(): Promise<void> {
    const chunk = takeChunk();
    if (chunk === null) return;
    try {
      prepare(chunk);
      await fsp.appendFile(file, chunk, 'utf8');
      size += Buffer.byteLength(chunk, 'utf8');
    } catch (err) {
      disable(err);
    }
  }

  return {
    dir,
    file,
    append(line) {
      if (disabled) return;
      pending.push(line);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        writeChain = writeChain.then(drain);
      }, flushIntervalMs);
      timer.unref?.();
    },
    async flush() {
      clearTimer();
      writeChain = writeChain.then(drain);
      await writeChain;
    },
    flushSync() {
      clearTimer();
      const chunk = takeChunk();
      if (chunk === null) return;
      try {
        prepare(chunk);
        fs.appendFileSync(file, chunk, 'utf8');
        size += Buffer.byteLength(chunk, 'utf8');
      } catch (err) {
        disable(err);
      }
    },
  };
}

let sink: LogFileSink | null = null;

export function getLogDir(): string {
  return path.join(app.getPath('userData'), LOG_DIR_NAME);
}

export function initLogFile(): void {
  if (sink || IS_TEST) return;
  sink = createLogFileSink({ dir: getLogDir() });
}

export function appendLogLine(line: string): void {
  if (IS_TEST) return;
  if (!sink) initLogFile();
  sink?.append(line);
}

export function flushLogFileSync(): void {
  sink?.flushSync();
}
