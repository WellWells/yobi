import type { FlowDefinition } from '../types';
import type { VideoIds } from '../linkSites/ids';
import { BOT_MODEL, CHAT_MODEL, END_IF, REPLY, chatFlowOf, flowOf, llmStep, stepsOf } from './steps';
import type { StepSpec as Step } from './steps';

/**
 * The transcript and the summary of it, by the prompt `youtubeSummaryPrompt` built, on
 * `provider`. The transcript step reads any video row's link through its site, and with no words
 * to sum up it ends the run with "no captions" (`requireTranscript`) rather than summarizing
 * nothing.
 */
function summarySteps(summaryPrompt: string, provider: string): Step[] {
  return [['youtube', { url: '{{info.url}}', requireTranscript: 'true' }, 'yt_1'], llmStep(summaryPrompt, provider)];
}

/** The "summary" branch, for a site whose menu has it (`summaryPrompt` given); nothing otherwise. */
function summaryBranch(summaryPrompt: string | null, provider: string, reply: Step[] = []): Step[] {
  if (summaryPrompt === null) return [];
  return [
    ['if', { left: '{{info.quality}}', operator: 'equals', right: 'summary' }],
    ...summarySteps(summaryPrompt, provider),
    ...reply,
    END_IF,
  ];
}

/**
 * The desktop chat's video menu, the bot one's twin, answered in the conversation: the cover, the
 * title and "analyze" (null `summaryPrompt`: no summary) and "download", which answers with a
 * button per quality, the MP3 and the subtitles (straight away for a site with no summary). A
 * quality, the MP3 or the subtitles save a file in the downloads folder (shown under the answer);
 * "analyze" is the bot chat's summary, on the chat's model.
 */
export function videoMenuChatFlow(ids: VideoIds, name: string, summaryPrompt: string | null): FlowDefinition {
  return chatFlowOf(ids.desktopMenu, name, stepsOf(ids.desktopMenu, [
    ['youtube_info', { input: '{{input}}', destination: 'local', cover: 'true', emitFailFlag: 'false' }, 'info'],
    ['stop', { value: '{{info.pick}}' }],
    ...summaryBranch(summaryPrompt, CHAT_MODEL),
    ['stop', { value: '{{info.download}}' }],
    ['youtube_download', { url: '{{info.url}}', quality: '{{info.quality}}', destination: 'local', folder: '' }, 'dl'],
  ]));
}

/**
 * A link alone: the cover, the title, "analyze" (null `summaryPrompt`: no summary) and
 * "download", which answers with one button per quality, the MP3 and the subtitles (straight away
 * for a site with no summary). With the preview grant on Telegram, a short video first comes as
 * itself at a low quality (`info.preview`), the same buttons under it; a preview that cannot be
 * sent leaves the menu in its place. A button runs this again with the link and its choice: the
 * summary, or the download sent back — a video to play, an MP3 to the music player, the .srt as a
 * document — (or, too large for a bot or on LINE, saved on this computer and said so).
 */
export function videoMenuFlow(ids: VideoIds, name: string, summaryPrompt: string | null): FlowDefinition {
  return flowOf(ids.menu, name, ids.cmdMenu, stepsOf(ids.menu, [
    // A slow read says "working" once, never which site it reads.
    ['youtube_info', { input: '{{input}}', destination: 'auto', emitFailFlag: 'false', progress: 'brief' }, 'info'],
    // A preview comes only with a menu, so `info.pick` is empty there: both stops end the run.
    // It is downloaded in the background — "working" until the video itself, nothing in between —
    // and the answer to a link pasted alone takes that message's place, the link in its caption.
    ['if', { left: '{{info.preview}}', operator: 'is_true', right: '' }],
    ['youtube_download', { url: '{{info.url}}', quality: '{{info.preview}}', destination: 'auto', folder: '', emitFailFlag: 'true', progress: 'brief' }, 'preview_dl'],
    ['if', { left: '{{preview_dl.savedLocally}}', operator: 'equals', right: '0' }],
    ['bot', {
      ...REPLY, message: '{{info.previewCaption}}', attachment: '{{preview_dl}}', attachmentType: 'video', buttons: '{{info.buttons}}',
      replaceTrigger: '{{info.replaceLink}}',
    }, 'bot_preview'],
    ['if', { left: '{{bot_preview.isFailed}}', operator: 'equals', right: '0' }],
    ['stop', { value: '{{info.pick}}' }],
    END_IF,
    END_IF,
    END_IF,
    ['if', { left: '{{info.pick}}', operator: 'is_empty', right: '' }],
    ['bot', {
      ...REPLY, message: '{{info.botText}}', attachment: '{{info.menuImage}}', attachmentType: 'photo', buttons: '{{info.buttons}}',
      replaceTrigger: '{{info.replaceLink}}',
    }, 'bot_menu'],
    ['stop', { value: '{{info.pick}}' }],
    END_IF,
    ...summaryBranch(summaryPrompt, BOT_MODEL, [['bot', { ...REPLY, message: '{{llm_1}}' }, 'bot_summary']]),
    ['stop', { value: '{{info.download}}' }],
    ['youtube_download', { url: '{{info.url}}', quality: '{{info.quality}}', destination: 'auto', folder: '' }, 'dl'],
    ['if', { left: '{{dl.savedLocally}}', operator: 'equals', right: '1' }],
    ['bot', { ...REPLY, message: '{{dl.summary}}' }, 'bot_saved'],
    END_IF,
    ['if', { left: '{{dl.savedLocally}}', operator: 'not_equals', right: '1' }],
    ['if', { left: '{{dl.kind}}', operator: 'equals', right: 'video' }],
    ['bot', { ...REPLY, message: '{{dl.title}}', attachment: '{{dl}}', attachmentType: 'video' }, 'bot_video'],
    END_IF,
    ['if', { left: '{{dl.kind}}', operator: 'equals', right: 'audio' }],
    ['bot', { ...REPLY, message: '{{dl.title}}', attachment: '{{dl}}', attachmentType: 'audio' }, 'bot_audio'],
    END_IF,
    ['if', { left: '{{dl.kind}}', operator: 'equals', right: 'subtitles' }],
    ['bot', { ...REPLY, message: '{{dl.summary}}', attachment: '{{dl}}', attachmentType: 'document' }, 'bot_subtitles'],
    END_IF,
    END_IF,
  ]));
}
