interface ErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * A closed stdout/stderr pipe fails every write with an 'error' event on the stream. Unhandled, that
 * becomes an uncaught exception whose logger writes to the same pipe, and the process spins forever.
 * Log lines also go to the log file, so a console that went away loses nothing.
 */
export function ignoreBrokenStdio(streams: ErrorSource[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) stream.on('error', () => {});
}
