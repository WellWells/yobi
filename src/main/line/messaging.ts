import type { LineClient } from './client';
import type { LineTextEvent } from './events';

export type LogFn = (message: string) => void;

export async function safePush(
  client: LineClient | null,
  to: string,
  text: string,
  onLog: LogFn,
): Promise<void> {
  if (!client) {
    onLog('[line] push skipped — client not ready');
    return;
  }
  try {
    await client.pushText(to, text);
  } catch (err: unknown) {
    onLog(`[line] push failed for ${to}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function respond(
  client: LineClient | null,
  event: LineTextEvent,
  text: string,
  onLog: LogFn,
): Promise<void> {
  if (!client) {
    onLog('[line] reply skipped — client not ready');
    return;
  }
  if (event.replyToken) {
    try {
      await client.replyText(event.replyToken, text);
      return;
    } catch (err: unknown) {
      onLog(`[line] reply failed for ${event.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await safePush(client, event.chatId, text, onLog);
}
