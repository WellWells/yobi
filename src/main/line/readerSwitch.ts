/**
 * The LINE connector was switched on or off (Settings › Connectors). The LINE PC bot reads through
 * the connector, so it follows: off stops it, on starts it again. No dependencies, so the IPC
 * handler and the bot's setup can both import it.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onLineReaderSwitched(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called once the switch has taken effect (the connector connected or closed). */
export function lineReaderSwitched(): void {
  for (const listener of listeners) listener();
}
