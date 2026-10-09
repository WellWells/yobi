/**
 * The send form a new conversation starts in. Only the user's own pick is remembered: a send that
 * switched to Agent by itself (a flow request, a named connector) changes that one conversation,
 * not what the next one starts as.
 */
const AGENT_DEFAULT_KEY = 'yobi.composer.agentDefault';

export function loadAgentDefault(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(AGENT_DEFAULT_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAgentDefault(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(AGENT_DEFAULT_KEY, on ? '1' : '0');
  } catch {
    // Storage unavailable (private mode, quota): the next new chat simply starts in plain chat.
  }
}
