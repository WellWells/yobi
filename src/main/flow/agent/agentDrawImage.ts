import { parseImageRequest } from '../../../shared/imageRequest';
import type { ImageProvider } from '../../../shared/imageRequest';
import { sendLog } from '../../helpers';
import { FlowAbortError } from '../runtime';

/*
 * The agent cannot draw: its replies are a tool protocol, and no BYOK key makes pictures. Handed a
 * picture request it could not route elsewhere (a Telegram reply asking for a chiikawa-style picture
 * of the quoted post, 2026-10-19), it wrote a paragraph about "the picture drawn for you" and sent no
 * picture. `draw_image` hands the drawing to Gemini's or ChatGPT's web page, as the image command
 * does, with a description the agent writes from what it has read; the pictures go out with the
 * run's answer. The caller does the drawing and keeps the files, so this module only words it.
 */

export const DRAW_IMAGE_TOOL = 'draw_image';

/** What one drawing came back with. The files stay with the caller, which delivers them. */
export interface DrawnPictures {
  /** Pictures kept from this drawing; 0 = none came back. */
  count: number;
  /** The page that drew it, as the user knows it ("Gemini"). */
  provider: string;
  /** The page's own words beside the pictures, or instead of them. */
  reply: string;
  /** No picture, and the page's words say its picture limit is used up. */
  limit?: boolean;
}

export type DrawImage = (prompt: string, provider: ImageProvider | null) => Promise<DrawnPictures>;

/** Enough for a picture and a redo or two; a run that keeps drawing is not converging. */
export const MAX_DRAW_CALLS_PER_RUN = 3;

const REPLY_CHARS = 300;

/**
 * What the catalog lists: every run that can deliver a picture carries it, so it is a tier-1 brief;
 * `tool_help` returns the full `DRAW_IMAGE_LINE`. The brief keeps what a first call needs to be right
 * — that only this tool's pictures reach the user, and that the drawer sees nothing but the prompt.
 */
export const DRAW_IMAGE_BRIEF = '- "draw_image": Make a PICTURE the user asks for; you cannot draw yourself, only pictures it returns reach the user. config: "prompt" (the whole picture, written from what you have read; REQUIRED). [+opts]';

export const DRAW_IMAGE_LINE ='- "draw_image": Make a PICTURE the user asks for (illustration, photo, poster, a style such as chibi or watercolor). You cannot draw yourself: only pictures this tool returns reach the user, attached to your answer. config keys: "prompt" (the whole picture — subject, style, any text on it — written from what you have read, since the drawer sees nothing else; REQUIRED), "provider" ("chatgpt" only when the user asks for ChatGPT/GPT; default Gemini) → returns: how many pictures were attached.';

export interface DrawContext {
  drawImage?: DrawImage;
  /** The user's own words in this run, read for "使用 gpt…" when the model named no provider. */
  userWords?: () => string;
  /** Drawings this run has made; counted here. */
  drawCalls?: number;
  signal?: AbortSignal;
}

function readProvider(value: string | undefined): ImageProvider | null {
  const named = (value ?? '').trim().toLowerCase();
  if (/^(?:chat\s*gpt|gpt|openai|dall)/.test(named)) return 'chatgpt';
  return named.startsWith('gemini') ? 'gemini' : null;
}

function said(provider: string, reply: string): string {
  const flat = reply.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return ` ${provider} said: "${flat.length > REPLY_CHARS ? `${flat.slice(0, REPLY_CHARS)}…` : flat}"`;
}

/** The observation for one drawing: pictures attached, or why there are none. */
export function drawObservation(result: DrawnPictures): { observation: string; status: 'ok' | 'error' } {
  const words = said(result.provider, result.reply);
  if (result.count > 0) {
    return {
      observation: `Attached ${result.count} picture(s) drawn by ${result.provider}.${words} They go out with your answer by themselves — no links, no image markdown. In "finish", say in a sentence or two what was drawn.`,
      status: 'ok',
    };
  }
  if (result.limit) {
    return {
      observation: `ERROR: ${result.provider} drew no picture: its picture limit looks used up.${words} Do not retry — tell the user, and that they can try again later.`,
      status: 'error',
    };
  }
  return {
    observation: `ERROR: ${result.provider} drew no picture.${words} If it refused the content, rewrite the description once; otherwise tell the user what it said. Never describe a picture as drawn.`,
    status: 'error',
  };
}

export async function runDrawImage(
  config: Record<string, string>,
  ctx: DrawContext,
): Promise<{ observation: string; status: 'ok' | 'error' }> {
  const prompt = (config.prompt ?? '').trim();
  if (!prompt) return { observation: 'ERROR: "prompt" is required.', status: 'error' };
  if (!ctx.drawImage) {
    return {
      observation: 'ERROR: Pictures cannot be drawn here. Tell the user you cannot make the picture in this chat — never describe one as drawn.',
      status: 'error',
    };
  }
  if ((ctx.drawCalls ?? 0) >= MAX_DRAW_CALLS_PER_RUN) {
    return { observation: `ERROR: This answer already has the pictures of ${MAX_DRAW_CALLS_PER_RUN} drawings. Finish with them.`, status: 'error' };
  }
  ctx.drawCalls = (ctx.drawCalls ?? 0) + 1;
  // The model's choice first; then the user's own "使用 gpt…"; then Gemini.
  const provider = readProvider(config.provider) ?? parseImageRequest(ctx.userWords?.() ?? '')?.provider ?? null;
  try {
    return drawObservation(await ctx.drawImage(prompt, provider));
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    if (ctx.signal?.aborted) throw new FlowAbortError();
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Agent] draw_image failed: ${message}`);
    return { observation: `ERROR: The picture could not be drawn: ${message}. Tell the user it was not made.`, status: 'error' };
  }
}
