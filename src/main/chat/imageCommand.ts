import { IPC } from '../../shared/types';
import { IMAGE_CHAT_FLOW_ID, imageProviderUrl, parseImageRequest } from '../../shared/imageRequest';
import type { ImageProvider } from '../../shared/imageRequest';
import { pickConversationTitle } from '../../shared/conversationTitle';
import { compactPreview } from '../../shared/textBudget';
import { estimateUsage } from '../../shared/tokenEstimate';
import { config } from '../config';
import { listOutputFiles } from '../files';
import { sendLog, sendToRenderer } from '../helpers';
import { localizeUserFacingError, t } from '../i18n';
import { detectProvider, getProviderLabel, preparePromptForProvider, runAutomation } from '../providers';
import { chatgptConversationId, discardChatgptConversation } from '../providers/chatgptDiscard';
import { withAnswerSvgPictures } from '../providers/generatedImages';
import type { GeneratedImage } from '../providers/generatedImages';
import { getTempChatConversation, isTempChatMode } from '../tempChat';
import type { ConversationTurn } from '../../shared/conversationDoc';
import { loadConversation } from './conversationStore';
import { IMAGE_CONTEXT_TURNS, buildImagePrompt, pointsBack } from './imagePrompt';
import { ensureWorkerWindow } from '../windows';
import { workerWindowUnavailable } from '../workerWindowError';
import { llmLane } from '../flow/lanes';
import { busyUntilSettled } from '../conversationBusy';
import { answerTextWithPictures, keepAnswerPictures } from './answerPictures';
import { deliverCommandResultToTempChat, saveCommandOutput } from './commandOutput';
import type { CommandOrigin } from './commandOrigin';
import type { FlowManager } from '../flow';

type Strings = Record<string, string>;

/*
 * A picture asked for where the chat's own send would not bring it back: one send to the web page
 * the user named ("使用 gpt…" = ChatGPT; nobody named = Gemini), the pictures kept with the chat's media and shown
 * under the answer, or sent as photos by a bot. Three outcomes, each told apart: pictures; no
 * picture, with the provider's own reason; and no picture because the day's quota is used up.
 */

export interface ImageRunRequest {
  /** The user's words as typed; who draws is read from them (`parseImageRequest`), Gemini when unnamed. */
  prompt: string;
  strings: Strings;
  origin: CommandOrigin;
  conversationPath?: string;
  /** Name prefix for the file the answer starts when there is no conversation yet (a bot chat's). */
  fileLabel?: string;
  clientToken?: string;
}

export interface ImageRunOutcome {
  success: boolean;
  /** As a person reads it: already localized. */
  error?: string;
  filePath?: string;
  answer?: string;
  title?: string;
  /** The kept pictures, in the answer's order. */
  files?: string[];
  providerLabel: string;
}

/** Why a picture request came back without one. */
export type ImageMiss = 'limit' | 'declined';

/**
 * Words a provider uses when the day's pictures are used up (Gemini: "you've reached your limit…
 * try again tomorrow"; ChatGPT: "image generation limit… upgrade"). Read only when no picture came
 * back, and only to word the failure: a provider's other refusals (a real person, a policy) are
 * shown in its own words. There is no language-free marker for this on either page.
 */
const LIMIT_WORDS = /(?:上限|限額|限额|額度|额度|配額|配额|用完|用盡|用尽|明天再|稍後再試|稍后再试|升級|升级|(?<![a-z])(?:limit|quota|tomorrow|try again later|come back later|upgrade)(?![a-z]))/i;

export function classifyImageMiss(reply: string): ImageMiss {
  return LIMIT_WORDS.test(reply) ? 'limit' : 'declined';
}

/** The failure a person reads: which provider, why, and the provider's own words. */
export function imageMissMessage(miss: ImageMiss, providerLabel: string, reply: string, strings: Strings): string {
  const said = compactPreview(reply.replace(/\s+/g, ' ').trim(), 240);
  const key = miss === 'limit' ? 'image.error.limit' : said ? 'image.error.declined' : 'image.error.empty';
  return t(strings, key, { provider: providerLabel, reply: said });
}

interface Drawn {
  response: string;
  title: string;
  images: GeneratedImage[];
}

/**
 * One send that draws. Gemini follows the temporary-chat setting like any one-shot send (its
 * temporary chat draws). ChatGPT's temporary chat cannot draw, so it gets a normal chat — deleted
 * as soon as it has been read when the send should not stay in its history.
 */
async function drawOnWeb(prompt: string, providerUrl: string, discard: boolean): Promise<Drawn> {
  return llmLane.runExclusive(async () => {
    // The request ends the prompt: refused rather than cut, at the cap that holds once it is our turn.
    const prepared = preparePromptForProvider(prompt, providerUrl, { refuseCut: true });
    const worker = await ensureWorkerWindow(config.targetUrl, 'automation');
    if (!worker || worker.isDestroyed()) throw workerWindowUnavailable();
    const chatgpt = detectProvider(providerUrl) === 'chatgpt';
    // The conversation the worker was parked on (the user's own, perhaps) is never the one to delete.
    const parkedOn = chatgptConversationId(worker.webContents.getURL());
    const result = await runAutomation(
      worker,
      prepared.prompt,
      config.responseTimeout,
      providerUrl,
      undefined,
      undefined,
      false,
      chatgpt ? false : undefined,
    );
    const pictured = await withAnswerSvgPictures(worker, result);
    // Only the conversation this send started, read off its own answer; a failed send deletes nothing.
    const created = chatgptConversationId(result.threadUrl);
    if (chatgpt && discard && created && created !== parkedOn) {
      await discardChatgptConversation(worker.webContents, result.threadUrl);
    }
    return { response: pictured.response, title: pictured.title, images: pictured.images ?? [] };
  });
}

/** What `/agent`'s `draw_image` got back: the kept pictures, or why there are none. */
export interface AgentDrawing {
  files: string[];
  providerLabel: string;
  reply: string;
  /** Set when no picture came back. */
  miss?: ImageMiss;
}

/**
 * A picture `/agent` asked for (`draw_image`): one send to the page, the pictures kept with the
 * chat's media for the run's answer to carry. No earlier turns go along — the agent's description
 * is written from everything it read, which is what `buildImagePrompt` stands in for here. Not
 * queued: the run asking is already a queue task, and the page itself is behind `llmLane`.
 */
export async function drawPicturesForAgent(prompt: string, provider: ImageProvider | null, discard: boolean): Promise<AgentDrawing> {
  const providerUrl = imageProviderUrl(provider);
  const providerLabel = getProviderLabel(providerUrl);
  sendLog(`🖼️ [Agent] Drawing on ${providerLabel}: "${compactPreview(prompt, 80)}"`);
  const drawn = await drawOnWeb(prompt, providerUrl, discard);
  const files = await keepAnswerPictures(drawn.images, providerLabel);
  if (files.length === 0) {
    const miss = classifyImageMiss(drawn.response);
    sendLog(`⚠️ [Agent] ${providerLabel} drew nothing (${miss}): ${compactPreview(drawn.response, 160)}`);
    return { files, providerLabel, reply: drawn.response, miss };
  }
  sendLog(`✅ [Agent] ${files.length} picture(s) from ${providerLabel}`);
  return { files, providerLabel, reply: drawn.response };
}

/**
 * The conversation the picture is asked in: the saved file (a desktop or bot chat), or Yobi's
 * temporary chat. Unreadable = none, so the picture is still drawn.
 */
async function earlierTurns(conversationPath: string | undefined, tempChat: boolean): Promise<ConversationTurn[]> {
  if (tempChat) return (await getTempChatConversation())?.turns ?? [];
  if (!conversationPath) return [];
  return (await loadConversation(conversationPath))?.doc.turns ?? [];
}

export function runImageCommand(flowManager: FlowManager | undefined, request: ImageRunRequest): Promise<ImageRunOutcome> {
  const { prompt, strings, conversationPath, origin } = request;
  // "使用 gpt 產生…" draws on ChatGPT and sends "產生…"; the turn keeps the words as typed.
  const asked = parseImageRequest(prompt);
  const providerUrl = imageProviderUrl(asked?.provider ?? null);
  const pagePrompt = asked?.prompt || prompt;
  const providerLabel = getProviderLabel(providerUrl);
  const tempChat = origin === 'app' && isTempChatMode();
  // Not kept in ChatGPT's history when no one-shot send is (the setting), nor from Yobi's temporary chat.
  const discard = config.oneShotTemporaryChat || tempChat;
  let startedAt = Date.now();

  const deliver = async (drawn: Drawn, files: string[]): Promise<ImageRunOutcome> => {
    const response = answerTextWithPictures(drawn.response, files.length, strings);
    const title = pickConversationTitle({ provider: drawn.title, prompt });
    const usage = estimateUsage(prompt, drawn.response);
    const markdownOptions = {
      prompt,
      turnMeta: { c: IMAGE_CHAT_FLOW_ID },
      response,
      title,
      provider: providerLabel,
      providerLabel: strings['md.provider'] ?? 'Provider',
      promptLabel: strings['md.prompt'] ?? 'Prompt',
      responseLabel: strings['md.response'] ?? 'Response',
      timestampLabel: strings['md.timestamp'] ?? 'Time',
    };
    const result = {
      markdownOptions,
      prompt,
      response,
      providerLabel,
      command: IMAGE_CHAT_FLOW_ID,
      usage,
      startedAt,
      chatMedia: files,
    };
    if (tempChat) {
      deliverCommandResultToTempChat(result);
      return { success: true, answer: response, title, files, providerLabel };
    }
    const filePath = await saveCommandOutput({
      ...result,
      conversationPath,
      ...(request.fileLabel ? { fileLabel: request.fileLabel } : {}),
    });
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    return { success: true, filePath, answer: response, title, files, providerLabel };
  };

  const run = async (): Promise<ImageRunOutcome> => {
    startedAt = Date.now();
    sendLog(`🖼️ [Image] Drawing on ${providerLabel}${discard && detectProvider(providerUrl) === 'chatgpt' ? ' (conversation deleted afterwards)' : ''}: "${compactPreview(prompt, 80)}"`);
    try {
      // Read now, not when it was asked: a turn that landed while this one waited is context too.
      const earlier = await earlierTurns(conversationPath, tempChat);
      if (earlier.length > 0 && pointsBack(pagePrompt)) sendLog(`🧵 [Image] Sending the last ${Math.min(earlier.length, IMAGE_CONTEXT_TURNS)} turn(s) along as context`);
      const drawn = await drawOnWeb(buildImagePrompt(pagePrompt, earlier), providerUrl, discard);
      const files = await keepAnswerPictures(drawn.images, providerLabel);
      if (files.length === 0) {
        const miss = classifyImageMiss(drawn.response);
        sendLog(`⚠️ [Image] ${providerLabel} drew nothing (${miss}): ${compactPreview(drawn.response, 160)}`);
        return { success: false, error: imageMissMessage(miss, providerLabel, drawn.response, strings), providerLabel };
      }
      sendLog(`✅ [Image] ${files.length} picture(s) from ${providerLabel} in ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`);
      return await deliver(drawn, files);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      sendLog(`❌ [Image] ${raw}`);
      return { success: false, error: localizeUserFacingError(raw, strings), providerLabel };
    }
  };

  const queued = flowManager
    ? flowManager.enqueueExternalTask(
      t(strings, 'image.queueLabel', { prompt: compactPreview(prompt, 40) }),
      run,
      (err) => ({
        success: false,
        error: localizeUserFacingError(err instanceof Error ? err.message : String(err), strings),
        providerLabel,
      }),
      undefined,
      (request.clientToken ?? '').trim() || undefined,
    )
    : run();
  // Busy from queued to delivered: the answer is written into this conversation.
  return busyUntilSettled(conversationPath, 'flowCommand', queued);
}
