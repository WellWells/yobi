import { stripConversationMarkers } from '../../../shared/conversationDoc';
import type { ConversationDoc } from '../../../shared/conversationDoc';
import { formatCardTime } from '../../../shared/captureCard';
import type {
  CaptureFormat,
  CaptureRange,
  CaptureSettings,
  CaptureTurn,
  MarkdownCaptureRequest,
} from '../../../shared/types';
import { DEFAULT_CAPTURE_WIDTH, clampCaptureMargin } from '../../../shared/types';
import { getResponseAliases } from '../utils/parseMarkdownBlocks';
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

function stripAfterResponseHeading(raw: string): string {
  const lines = raw.split('\n');
  const responseAliases = getResponseAliases();
  const responseIdx = lines.findIndex((line) => {
    const m = line.trim().match(/^##\s+(.+)$/);
    return m != null && responseAliases.has(m[1].trim());
  });
  if (responseIdx < 0) return raw;
  return lines.slice(0, responseIdx).join('\n').trim();
}

function buildSummary(raw: string): string {
  const plain = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > 220 ? `${plain.slice(0, 220)}…` : plain;
}

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

export function conversationCaptureRequest(
  source: ConversationCaptureSource,
  choice: ConversationCaptureChoice,
): MarkdownCaptureRequest {
  const { blocks, conversation } = source;
  const cleanFile = stripConversationMarkers(source.content);
  const contentToCapture = stripConversationMarkers(blocks.response || source.content);
  const preResponse = stripAfterResponseHeading(cleanFile);
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
    summary: buildSummary(preResponse || contentToCapture),
    provider: blocks.provider || '',
    timestamp: formatCardTime(blocks.time || '', choice.locale),
    turns: captureTurnsFor(conversation, blocks, choice.locale, choice.t),
    tokensTotal: totalTokenLabel(choice.range === 'last' ? turnMetas.slice(-1) : turnMetas, choice.t),
  });
}
