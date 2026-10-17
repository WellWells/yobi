import { stripConversationMarkers } from '../../../shared/conversationDoc';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { formatCardTime } from '../../../shared/captureCard';
import { notionDocParts } from '../../../shared/notion/notionDoc';
import { notionToDisplay, plainNotionTitle } from '../../../shared/notion/notionDisplay';
import type {
  CaptureFormat,
  CaptureRange,
  CaptureSettings,
  CaptureTurn,
  MarkdownCaptureRequest,
} from '../../../shared/types';
import { DEFAULT_CAPTURE_WIDTH, clampCaptureMargin } from '../../../shared/types';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { totalTokenLabel, turnTokenLabel } from '../utils/captureTokens';
import { captureBackgroundCss, paletteCardTheme } from './captureTheme';
import type { CaptureBackgroundStyle, CaptureDirection } from './captureTheme';
import { buildCaptureRequest } from './captureRequest';
import type { CaptureLook } from './captureRequest';

type Translate = (key: string) => string;

/**
 * One conversation file turned into a capture card. The export dialog and the sidebar's batch
 * export both build their request here, so a conversation exported on its own and the same one
 * exported in a batch come out as the same card.
 */

/** The card's look, straight from the saved Card style. */
export function captureLookFrom(capture: CaptureSettings): CaptureLook {
  return {
    background: captureBackgroundCss(
      capture.palette,
      capture.backgroundStyle as CaptureBackgroundStyle,
      capture.direction as CaptureDirection,
    ),
    cardTheme: paletteCardTheme(capture.palette),
    cardLayout: capture.cardLayout,
    width: capture.width || DEFAULT_CAPTURE_WIDTH,
    margin: clampCaptureMargin(capture.margin),
    pixelRatio: capture.pixelRatio === 2 ? 2 : 1,
    zip: capture.zip,
    showProvider: capture.showProvider,
    showTimestamp: capture.showTimestamp,
    showTokens: capture.showTokens,
  };
}

export function captureTurnsFor(
  conversation: ConversationDoc | null,
  blocks: MarkdownBlocks | null,
  locale: string,
  t: Translate,
): CaptureTurn[] {
  const docProvider = blocks?.provider || '';
  const docTime = formatCardTime(blocks?.time || '', locale);
  if (conversation && conversation.turns.length > 0) {
    return conversation.turns.map((turn) => ({
      prompt: turn.prompt,
      response: turn.response,
      provider: turn.meta.p || docProvider,
      timestamp: formatCardTime(turn.meta.t ?? '', locale) || docTime,
      tokens: turnTokenLabel(turn.meta, t),
    }));
  }
  if (!blocks?.prompt && !blocks?.response) return [];
  return [{
    prompt: blocks.prompt || '',
    response: blocks.response || '',
    provider: docProvider,
    timestamp: docTime,
  }];
}

export interface ConversationCaptureSource {
  /** The file as stored, markers and all. */
  content: string;
  blocks: MarkdownBlocks;
  conversation: ConversationDoc | null;
  title: string;
  fileName: string;
}

export interface ConversationCaptureChoice {
  look: CaptureLook;
  format: CaptureFormat;
  range: CaptureRange;
  showPrompt: boolean;
  locale: string;
  t: Translate;
}

/**
 * A Notion document's card is the page as it reads in Yobi, not Notion's own Markdown: one answer
 * with no question, from Notion, timed at the last sync. Anything else is left as it is.
 */
export function readableCaptureSource(source: ConversationCaptureSource, t: Translate): ConversationCaptureSource {
  const doc = notionDocParts(source.content);
  if (!doc) return source;
  const body = notionToDisplay(doc.body, { unsupported: t('notion.block.unsupported') });
  const at = doc.thread.notion.at;
  return {
    ...source,
    content: body,
    // A title left as the dialog filled it in is the page's own, whose bold runs Notion splits.
    title: source.title === doc.title ? plainNotionTitle(doc.title) : source.title,
    blocks: { ...source.blocks, title: plainNotionTitle(doc.title), prompt: '', response: body, provider: 'Notion', time: at },
    conversation: {
      title: plainNotionTitle(doc.title),
      provider: 'Notion',
      time: null,
      thread: doc.thread,
      turns: [{ prompt: '', response: body, meta: { p: 'Notion', t: at } }],
    },
  };
}

export function conversationCaptureRequest(
  original: ConversationCaptureSource,
  choice: ConversationCaptureChoice,
): MarkdownCaptureRequest {
  const source = readableCaptureSource(original, choice.t);
  const { blocks, conversation } = source;
  const contentToCapture = stripConversationMarkers(blocks.response || source.content);
  const turnMetas = conversation?.turns ?? [];
  return buildCaptureRequest({
    ...choice.look,
    title: source.title,
    fileName: source.fileName,
    format: choice.format,
    range: choice.range,
    showPrompt: choice.showPrompt,
    prompt: stripConversationMarkers(blocks.prompt || ''),
    content: contentToCapture,
    summary: '',
    provider: blocks.provider || '',
    timestamp: formatCardTime(blocks.time || '', choice.locale),
    turns: captureTurnsFor(conversation, blocks, choice.locale, choice.t),
    tokensTotal: totalTokenLabel(choice.range === 'last' ? turnMetas.slice(-1) : turnMetas, choice.t),
  });
}
