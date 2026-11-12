import { pageAnalyzeChoice, pageForwardForLine } from '../botChat/pageForward';
import type { BotPageForward } from '../../shared/types';
import type { LineClient } from './client';
import { isLineSendableImage, lineMenuFits, lineMenuMessage, type LineMenuButton } from './flowMenu';
import { formatLineText } from './format';
import { safePush } from './messaging';

type LogFn = (line: string) => void;

function menuOf(text: string, buttons: readonly LineMenuButton[]): Parameters<typeof lineMenuMessage>[0] {
  return { text, buttons, altText: text.split('\n').map((line) => line.trim()).filter(Boolean).join(' ') };
}

/** Any picture that does not go is only logged: its words still do. */
async function pushImages(client: LineClient, to: string, images: readonly string[], onLog: LogFn): Promise<void> {
  for (const image of images.filter(isLineSendableImage)) {
    await client.pushImage(to, image).catch((err: unknown) => onLog(`[line] page picture not sent: ${String(err)}`));
  }
}

/**
 * Pictures, then the words. The button is a card: a short page is that one card, a longer one its
 * text and a card under it, since a card holds far less than a message. A link too long for a
 * button's data goes without one.
 */
export async function pushPageForward(
  client: LineClient | null,
  to: string,
  forward: BotPageForward,
  strings: Record<string, string>,
  onLog: LogFn,
): Promise<void> {
  const text = formatLineText(pageForwardForLine(forward, strings));
  if (!client) {
    await safePush(client, to, text, onLog);
    return;
  }
  await pushImages(client, to, forward.images, onLog);
  const buttons = [pageAnalyzeChoice(forward, strings)];
  const opening = formatLineText(forward.opening);
  const alone = lineMenuFits(text, buttons);
  if (!alone) await safePush(client, to, text, onLog);
  const card = alone ? text : opening;
  if (!lineMenuFits(card, buttons)) return;
  try {
    await client.pushFlex(to, lineMenuMessage(menuOf(card, buttons)));
  } catch (err: unknown) {
    onLog(`[line] page menu not sent: ${String(err)}`);
    if (alone) await safePush(client, to, text, onLog);
  }
}
