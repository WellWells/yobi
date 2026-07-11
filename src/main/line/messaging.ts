import type { LineClient } from './client';
import type { LineTextEvent } from './events';

export type LogFn = (message: string) => void;

// Pushes are metered against the Official Account's monthly quota; a failure is
// never worth crashing a dispatch loop or a task result over. `to` is any push
// destination the Messaging API accepts: a userId, groupId or roomId.
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

// Answers an inbound event on its reply token. Replies are free, pushes are not,
// so anything an unpaired user can trigger must go through here — otherwise
// flooding the bot with messages would drain the account's push quota. Falls
// back to push only when the token is missing or already spent.
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
