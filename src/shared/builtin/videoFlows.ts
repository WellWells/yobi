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
 * The desktop chat's video menu, the bot one's twin: the cover, the title and a button per
 * quality plus "summary" (null `summaryPrompt`: no summary), the MP3 and the subtitles, answered in
 * the conversation. A quality, the MP3 or the subtitles save a file in the downloads folder (shown
 * under the answer); "summary" is the bot chat's summary, on the chat's model.
 */
export function videoMenuChatFlow(ids: VideoIds, name: string, summaryPrompt: string | null): FlowDefinition {
  return chatFlowOf(ids.desktopMenu, name, stepsOf(ids.desktopMenu, [
    ['youtube_info', { input: '{{input}}', destination: 'local', cover: 'true', emitFailFlag: 'false' }, 'info'],
    ['stop', { value: '{{info.quality}}' }],
    ...summaryBranch(summaryPrompt, CHAT_MODEL),
    ['stop', { value: '{{info.download}}' }],
    ['youtube_download', { url: '{{info.url}}', quality: '{{info.quality}}', destination: 'local', folder: '' }, 'dl'],
  ]));
}

/**
 * A link alone: the cover, the title and one button per quality plus "summary" (null
 * `summaryPrompt`: no summary), the MP3 and the subtitles. A button runs this again with the link
 * and its choice: the summary, or the download sent back — a video to play, an MP3 to the music
 * player, the .srt as a document — (or, too large for a bot or on LINE, saved on this computer and
 * said so).
 */
export function videoMenuFlow(ids: VideoIds, name: string, summaryPrompt: string | null): FlowDefinition {
  return flowOf(ids.menu, name, ids.cmdMenu, stepsOf(ids.menu, [
    ['youtube_info', { input: '{{input}}', destination: 'auto', emitFailFlag: 'false' }, 'info'],
    ['if', { left: '{{info.quality}}', operator: 'is_empty', right: '' }],
    ['bot', { ...REPLY, message: '{{info}}', attachment: '{{info.image}}', attachmentType: 'photo', buttons: '{{info.buttons}}' }, 'bot_menu'],
    ['stop', { value: '{{info.quality}}' }],
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
