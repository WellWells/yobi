/*
 * A command's output as the chat keeps it. Bytes are held as a head and a tail (a build log can run
 * to megabytes, and the useful part is usually its end), both cut at a newline: 0x0A is a single
 * byte in UTF-8 and never the second byte of a Big5/GBK/Shift-JIS pair, so the cut never splits a
 * character whichever code page the console wrote in.
 */

const NEWLINE = 0x0a;

export const CAPTURE_HEAD_BYTES = 256 * 1024;
export const CAPTURE_TAIL_BYTES = 256 * 1024;

function newlinesIn(bytes: Buffer): number {
  let count = 0;
  for (const byte of bytes) if (byte === NEWLINE) count += 1;
  return count;
}

export interface CapturedBytes {
  /** All of the output, or its first part when something was dropped. */
  head: Buffer;
  /** The output's last part; empty when nothing was dropped. */
  tail: Buffer;
  /** Lines dropped between head and tail; 0 when everything was kept. */
  droppedLines: number;
}

export class OutputCapture {
  private readonly headChunks: Buffer[] = [];
  private headSize = 0;
  private tailChunks: Buffer[] = [];
  private tailSize = 0;
  private droppedLines = 0;
  private dropped = false;

  constructor(
    private readonly headMax = CAPTURE_HEAD_BYTES,
    private readonly tailMax = CAPTURE_TAIL_BYTES,
  ) {}

  push(chunk: Buffer): void {
    let rest = chunk;
    if (this.headSize < this.headMax) {
      const take = rest.subarray(0, this.headMax - this.headSize);
      this.headChunks.push(take);
      this.headSize += take.length;
      rest = rest.subarray(take.length);
    }
    if (rest.length === 0) return;
    this.tailChunks.push(rest);
    this.tailSize += rest.length;
    while (this.tailSize > this.tailMax) {
      const first = this.tailChunks[0];
      const excess = this.tailSize - this.tailMax;
      const evicted = excess >= first.length ? first : first.subarray(0, excess);
      if (evicted === first) this.tailChunks.shift();
      else this.tailChunks[0] = first.subarray(excess);
      this.tailSize -= evicted.length;
      this.droppedLines += newlinesIn(evicted);
      this.dropped = true;
    }
  }

  bytes(): CapturedBytes {
    const head = Buffer.concat(this.headChunks);
    const tail = Buffer.concat(this.tailChunks);
    if (!this.dropped) return { head: Buffer.concat([head, tail]), tail: Buffer.alloc(0), droppedLines: 0 };
    const headEnd = head.lastIndexOf(NEWLINE);
    const tailStart = tail.indexOf(NEWLINE);
    return {
      head: headEnd >= 0 ? head.subarray(0, headEnd) : head,
      tail: tailStart >= 0 ? tail.subarray(tailStart + 1) : tail,
      // The partial line either side of the cut went too.
      droppedLines: this.droppedLines + 1,
    };
  }

  /** The last `maxBytes` of output, from a line start: what the chat shows while it runs. */
  latest(maxBytes: number): Buffer {
    const source = this.dropped
      ? Buffer.concat(this.tailChunks)
      : Buffer.concat([...this.headChunks, ...this.tailChunks]);
    if (source.length <= maxBytes) return source;
    const window = source.subarray(source.length - maxBytes);
    const start = window.indexOf(NEWLINE);
    return start >= 0 ? window.subarray(start + 1) : window;
  }
}

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Terminal text as it would read on screen: colour codes gone, CRLF as LF, a line redrawn with a
 * bare CR (a progress bar) showing only what was drawn last, no blank lines at either end.
 */
export function cleanTerminalText(text: string): string {
  return text
    .replace(ANSI_SEQUENCE, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const redrawn = line.split('\r');
      let last = redrawn.length - 1;
      while (last > 0 && redrawn[last] === '') last -= 1;
      return redrawn[last].replace(CONTROL, '').trimEnd();
    })
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** The last `maxLines` lines of `text`. */
export function lastLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  return lines.length <= maxLines ? text : lines.slice(-maxLines).join('\n');
}

export interface OutputText {
  /** All of the output, or its first part when `droppedLines` > 0. */
  head: string;
  /** The output's last part when `droppedLines` > 0; '' otherwise. */
  tail: string;
  droppedLines: number;
}

const HEAD_SHARE = 0.4;

/**
 * The output within about `maxChars`: its first lines and its last, with `marker(n)` standing for
 * the `n` lines left out between them. A first or last line longer than its share is cut by
 * characters.
 */
export function clipOutput(output: OutputText, maxChars: number, marker: (omittedLines: number) => string): string {
  const whole = output.droppedLines === 0;
  if (whole && output.head.length <= maxChars) return output.head;
  const headLines = output.head ? output.head.split('\n') : [];
  const tailLines = whole ? headLines : (output.tail ? output.tail.split('\n') : []);
  const headBudget = Math.floor(maxChars * HEAD_SHARE);
  const tailBudget = maxChars - headBudget;

  let headCount = 0;
  let used = 0;
  while (headCount < headLines.length && used + headLines[headCount].length + 1 <= headBudget) {
    used += headLines[headCount].length + 1;
    headCount += 1;
  }
  const tailRoom = whole ? headLines.length - headCount : tailLines.length;
  let tailCount = 0;
  used = 0;
  while (tailCount < tailRoom && used + tailLines[tailLines.length - 1 - tailCount].length + 1 <= tailBudget) {
    used += tailLines[tailLines.length - 1 - tailCount].length + 1;
    tailCount += 1;
  }

  const omitted = whole
    ? headLines.length - headCount - tailCount
    : headLines.length - headCount + output.droppedLines + tailLines.length - tailCount;
  const head = headCount > 0
    ? headLines.slice(0, headCount).join('\n')
    : (headLines[0] ?? '').slice(0, headBudget);
  const tail = tailCount > 0
    ? tailLines.slice(tailLines.length - tailCount).join('\n')
    : (tailLines[tailLines.length - 1] ?? '').slice(-tailBudget);
  return [head, marker(Math.max(1, omitted)), tail].filter(Boolean).join('\n');
}
