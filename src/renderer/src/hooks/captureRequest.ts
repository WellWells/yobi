import { stripConversationMarkers } from '../../../shared/conversationDoc';
import type {
  CaptureFormat,
  CaptureRange,
  CaptureTurn,
  CardLayout,
  CardTheme,
  MarkdownCaptureRequest,
} from '../../../shared/types';

export interface CaptureLook {
  background: string;
  cardTheme: CardTheme;
  cardLayout: CardLayout;
  width: number;
  margin: number;
  pixelRatio: number;
  zip: boolean;
  showProvider: boolean;
  showTimestamp: boolean;
  showTokens: boolean;
}

export interface ConversationCaptureInput extends CaptureLook {
  title: string;
  fileName: string;
  format: CaptureFormat;
  range: CaptureRange;
  showPrompt: boolean;
  prompt: string;
  content: string;
  summary: string;
  provider: string;
  timestamp: string;
  turns: CaptureTurn[];
  tokensTotal?: string;
}

export function mustShowPrompt(cardLayout: CardLayout, exportedTurnCount: number): boolean {
  return cardLayout === 'bubble' || exportedTurnCount > 1;
}

export function buildCaptureRequest(input: ConversationCaptureInput): MarkdownCaptureRequest {
  const turns = input.range === 'last' ? input.turns.slice(-1) : input.turns;
  return {
    payload: {
      title: input.title,
      prompt: input.prompt,
      content: input.content,
      summary: input.summary,
      provider: input.provider || turns[0]?.provider || '',
      timestamp: input.timestamp || turns[0]?.timestamp || '',
      turns,
      tokensTotal: input.tokensTotal,
    },
    options: {
      mode: 'save',
      format: input.format,
      showPrompt: mustShowPrompt(input.cardLayout, turns.length) || input.showPrompt,
      showContent: true,
      showProvider: input.showProvider,
      showTimestamp: input.showTimestamp,
      showTokens: input.showTokens,
      fileName: input.fileName,
      width: input.width,
      margin: input.margin,
      background: input.background,
      cardTheme: input.cardTheme,
      cardLayout: input.cardLayout,
      pixelRatio: input.pixelRatio,
      zip: input.zip,
    },
  };
}

export interface TurnCaptureInput extends CaptureLook {
  title: string;
  fileName: string;
  format: CaptureFormat;
  turn: CaptureTurn;
}

export function buildTurnCaptureRequest(input: TurnCaptureInput): MarkdownCaptureRequest {
  const response = stripConversationMarkers(input.turn.response);
  return {
    payload: {
      title: input.title,
      prompt: '',
      content: response,
      summary: '',
      provider: input.turn.provider ?? '',
      timestamp: input.turn.timestamp ?? '',
      turns: [{ ...input.turn, prompt: '', response }],
      tokensTotal: input.showTokens ? (input.turn.tokens ?? '') : '',
    },
    options: {
      mode: 'copy',
      format: input.format,
      showPrompt: false,
      showContent: true,
      showProvider: input.showProvider,
      showTimestamp: input.showTimestamp,
      showTokens: input.showTokens,
      fileName: input.fileName,
      width: input.width,
      margin: input.margin,
      background: input.background,
      cardTheme: input.cardTheme,
      cardLayout: input.cardLayout,
      pixelRatio: input.pixelRatio,
      zip: input.zip,
    },
  };
}
