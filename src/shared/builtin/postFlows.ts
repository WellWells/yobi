import type { FlowDefinition, SkillType } from '../types';
import type { PostIds } from '../linkSites/ids';
import { MP3_LABEL } from '../ytdl';
import { pushesAnalyzePrompt, xAccountAnalyzePrompt, xAnalyzePrompt } from './prompts';
import { BOT_MODEL, CHAT_MODEL, END_IF, REPLY, chatFlowOf, flowOf, llmStep, stepsOf, type StepSpec } from './steps';

/**
 * The post's text with its video or photos under it (one album for several), the text alone when
 * there are none; a post over Telegram's caption limit goes out as its own message first. Under
 * it, "analyze": the link and the word, which runs the analyze flow — none under a story, where
 * `x_media` leaves the line empty and the button drops out — and "MP3" when the post has a video
 * (`{{xm.mp3}}`, empty otherwise). A link offering several items (a person's Facebook stories)
 * gets their menu instead: the items' pictures (Telegram's album, LINE's cards from
 * `buttonImages`) and a button per item.
 */
export function postForwardFlow(ids: PostIds, name: string, analyzeLabel: string): FlowDefinition {
  const button = `${analyzeLabel} | {{xm.analyze}}\n${MP3_LABEL} | {{xm.mp3}}\n{{xm.buttons}}`;
  return flowOf(ids.forward, name, ids.cmdForward, stepsOf(ids.forward, [
    ['x_media', { input: '{{input}}', destination: 'auto', folder: '', reader: '' }, 'xm'],
    ['if', { left: '{{xm.overflow}}', operator: 'is_true', right: '' }],
    ['bot', { ...REPLY, message: '{{xm.overflow}}' }, 'bot_text'],
    END_IF,
    ['bot', { ...REPLY, message: '{{xm.caption}}', attachment: '{{xm}}', preview: '{{xm.previews}}', buttons: button, buttonImages: '{{xm.buttonImages}}' }, 'bot_media'],
  ]));
}

/**
 * The desktop chat's forward: the post with its media — the version a Telegram chat gets — shown
 * in the conversation and kept only in the chat's cache, nothing sent anywhere. The turn's own
 * buttons save it to the downloads folder or analyze it.
 */
export function postViewFlow(ids: PostIds, name: string): FlowDefinition {
  return chatFlowOf(ids.desktopPost, name, stepsOf(ids.desktopPost, [
    ['x_media', { input: '{{input}}', destination: 'preview', folder: '', reader: '' }, 'xm'],
  ]));
}

/** "Download" under a shown post: the best version of its media saved in the downloads folder. */
export function postSaveFlow(ids: PostIds, name: string): FlowDefinition {
  return chatFlowOf(ids.desktopSave, name, stepsOf(ids.desktopSave, [
    ['x_media', { input: '{{input}}', destination: 'local', folder: '', reader: '' }, 'xm'],
    // The post is already above; this turn only says where its media went.
    ['text', { text: '{{xm.summary}}{{xm.notice}}' }, 'saved'],
  ]));
}

/** `x_media` turning the post's videos into MP3s; `audio` is a built-in's own field, not one a person's flow sets. */
const AUDIO_STEP = { input: '{{input}}', folder: '', reader: '', audio: 'mp3' };

/**
 * "MP3" under a forwarded post with a video, in a bot chat: each video's sound as an MP3 (FFmpeg on
 * the forwarded mp4 — `x_media`'s `audio`), sent to Telegram's music player; too large for a bot,
 * or on LINE, saved on this computer and said so.
 */
export function postAudioFlow(ids: PostIds, name: string): FlowDefinition {
  return flowOf(ids.audio, name, ids.cmdAudio, stepsOf(ids.audio, [
    ['x_media', { ...AUDIO_STEP, destination: 'auto' }, 'xm'],
    ['if', { left: '{{xm.savedLocally}}', operator: 'equals', right: '1' }],
    ['bot', { ...REPLY, message: '{{xm.summary}}' }, 'bot_saved'],
    END_IF,
    ['if', { left: '{{xm.savedLocally}}', operator: 'not_equals', right: '1' }],
    ['bot', { ...REPLY, message: '{{xm.caption}}', attachment: '{{xm}}', attachmentType: 'audio' }, 'bot_audio'],
    END_IF,
  ]));
}

/** The desktop chat's "MP3" under a shown post: the MP3s saved in the downloads folder, shown under the answer. */
export function postAudioChatFlow(ids: PostIds, name: string): FlowDefinition {
  return chatFlowOf(ids.desktopAudio, name, stepsOf(ids.desktopAudio, [
    ['x_media', { ...AUDIO_STEP, destination: 'local' }, 'xm'],
    ['text', { text: '{{xm.summary}}' }, 'saved'],
  ]));
}

/**
 * What a site's replies are: ordinary replies, or PTT's pushes (the row's `pushes`) — hundreds of
 * one-line verdicts read by a character budget and analyzed with a prompt of their own.
 */
export type ReplyStyle = 'replies' | 'pushes';

/** Pushes an analysis may read: the character budget, not this, is what stops a big thread. */
const PUSHES_READ_MAX = '1000';

/** Replies an analysis reads, unless the row says otherwise (`PostRow.analysisReplies`). */
export const DEFAULT_ANALYSIS_REPLIES = 40;

/**
 * The post and the replies the site shows, read without the agent; PTT's pushes as many as fit
 * `x_thread`'s character budget, sampled past it. A site whose analysis reads more says so on its
 * row, so no other site's prompt grows.
 */
function threadStep(style: ReplyStyle, maxReplies = DEFAULT_ANALYSIS_REPLIES): [SkillType, Record<string, string>, string] {
  return ['x_thread', { url: '{{input}}', maxReplies: style === 'pushes' ? PUSHES_READ_MAX : String(maxReplies), emitFailFlag: 'false' }, 'xt'];
}

/**
 * The one model call of an analysis: the post and its replies, or — when the link named a whole
 * account (an Instagram profile, `x_thread`'s `.subject`) — the account. Only one branch runs, and
 * both answer as `llm_1`. An article's pushes have one prompt of their own.
 */
function analysisSteps(locale: string, model: string, style: ReplyStyle): StepSpec[] {
  if (style === 'pushes') return [llmStep(pushesAnalyzePrompt(locale), model)];
  return [
    ['if', { left: '{{xt.subject}}', operator: 'equals', right: 'account' }],
    llmStep(xAccountAnalyzePrompt(locale), model),
    END_IF,
    ['if', { left: '{{xt.subject}}', operator: 'not_equals', right: 'account' }],
    llmStep(xAnalyzePrompt(locale), model),
    END_IF,
  ];
}

/**
 * "Analyze" under a forwarded post, in a bot chat: the post and its replies read, summed up by
 * one model call and sent back. No agent and no tools to choose.
 */
export function postAnalyzeFlow(ids: PostIds, name: string, locale: string, style: ReplyStyle = 'replies', maxReplies?: number): FlowDefinition {
  return flowOf(ids.analyze, name, ids.cmdAnalyze, stepsOf(ids.analyze, [
    threadStep(style, maxReplies),
    ...analysisSteps(locale, BOT_MODEL, style),
    ['bot', { ...REPLY, message: '{{llm_1}}' }, 'bot_analysis'],
  ]));
}

/** The desktop chat's "analyze": the same analysis on the chat's model, answered in the conversation. */
export function postAnalyzeChatFlow(ids: PostIds, name: string, locale: string, style: ReplyStyle = 'replies', maxReplies?: number): FlowDefinition {
  return chatFlowOf(ids.desktopAnalyze, name, stepsOf(ids.desktopAnalyze, [
    threadStep(style, maxReplies),
    ...analysisSteps(locale, CHAT_MODEL, style),
  ]));
}
