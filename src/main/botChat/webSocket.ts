/**
 * The slice of the WebSocket API the socket platforms use (Node's global `WebSocket`), so tests
 * can hand in a fake one.
 */
export interface BotWebSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type BotWebSocketFactory = (url: string) => BotWebSocket;

export function openBotWebSocket(url: string): BotWebSocket {
  return new WebSocket(url) as unknown as BotWebSocket;
}
