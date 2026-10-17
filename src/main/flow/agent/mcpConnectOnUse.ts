import type { McpRegistry } from '../../mcp';
import { FlowAbortError } from '../runtime';

/**
 * How long a run that named no connector waits for the ones it would be offered before going on
 * without them. A run that named one waits for the attempt to end: answering without the server
 * the user asked for is what the not-connected error exists to prevent.
 */
export const SWEEP_CONNECT_WAIT_MS = 10_000;

export interface ConnectForRunRequest {
  /** The connectors the user named (a `/context7`, a send that mentions one); undefined when none. */
  declared?: readonly string[];
  /** The only servers the run may reach (a bot account's grants); undefined when unrestricted. */
  allowed?: readonly string[];
  signal?: AbortSignal;
  /** Told the names of the servers being connected, before the wait starts. */
  onConnecting?: (names: string) => void;
}

/**
 * Connects the servers a run is about to use that are not connected yet, so an open connector
 * (Context7, DeepWiki) answers its first command after a restart instead of failing with "not
 * connected". Never interactive: a server that needs a sign-in stays as it was. Throws only when
 * the run is cancelled while it waits.
 */
export async function connectServersForRun(
  registry: Pick<McpRegistry, 'connectForUse'>,
  request: ConnectForRunRequest,
): Promise<void> {
  const { declared, allowed, signal } = request;
  const ids = declared ? declared.filter((id) => !allowed || allowed.includes(id)) : allowed;
  if (ids?.length === 0) return;
  const use = registry.connectForUse?.(ids, declared !== undefined);
  if (!use || use.names.length === 0) return;
  request.onConnecting?.(use.names.join(', '));
  await settleWithin(use.settled, signal, declared ? undefined : SWEEP_CONNECT_WAIT_MS);
}

function settleWithin(task: Promise<void>, signal: AbortSignal | undefined, waitMs: number | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(new FlowAbortError());
  return new Promise<void>((resolve, reject) => {
    const timer = waitMs === undefined ? undefined : setTimeout(finish, waitMs);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort(): void {
      clearTimeout(timer);
      reject(new FlowAbortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void task.then(finish, finish);
  });
}
