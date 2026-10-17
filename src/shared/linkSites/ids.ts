import type { PostSiteId, VideoSiteId } from './types';

/**
 * A post site's built-ins: the bot chat's forward, "analyze" and MP3, and the desktop chat's twins
 * (show the post, save its media, analyze it, its MP3). A bot built-in also has the command its
 * buttons and the bots run it by; a desktop built-in's command is its id.
 */
export interface PostIds {
  forward: string;
  analyze: string;
  audio: string;
  desktopPost: string;
  desktopSave: string;
  desktopAnalyze: string;
  desktopAudio: string;
  cmdForward: string;
  cmdAnalyze: string;
  cmdAudio: string;
}

/** A video site's built-ins: the bot chat's quality menu, its desktop twin, and the menu's command. */
export interface VideoIds {
  menu: string;
  desktopMenu: string;
  cmdMenu: string;
}

/**
 * Names shipped before the ids were derived, which old conversation files and Telegram buttons
 * still carry: X's forward command is `x`, and YouTube's whole set is `ytdl`. Never change them.
 */
const POST_OVERRIDES: Partial<Record<PostSiteId, Partial<PostIds>>> = { x: { cmdForward: 'x' } };
const VIDEO_OVERRIDES: Partial<Record<VideoSiteId, Partial<VideoIds>>> = {
  youtube: { menu: 'builtin-ytdl', desktopMenu: 'builtin-ytdl-chat', cmdMenu: 'ytdl' },
};

/**
 * Every derived command holds a `-`, which a person's own bot command never does
 * (`BOT_COMMAND_RE`), so the two can never collide.
 */
export function postIds(site: PostSiteId): PostIds {
  return {
    forward: `builtin-${site}-forward`,
    analyze: `builtin-${site}-analyze`,
    audio: `builtin-${site}-mp3`,
    desktopPost: `builtin-${site}-post`,
    desktopSave: `builtin-${site}-save`,
    desktopAnalyze: `builtin-${site}-analyze-chat`,
    desktopAudio: `builtin-${site}-mp3-chat`,
    cmdForward: `${site}-forward`,
    cmdAnalyze: `${site}-analyze`,
    cmdAudio: `${site}-mp3`,
    ...POST_OVERRIDES[site],
  };
}

export function videoIds(site: VideoSiteId): VideoIds {
  return {
    menu: `builtin-${site}-menu`,
    desktopMenu: `builtin-${site}-menu-chat`,
    cmdMenu: `${site}-menu`,
    ...VIDEO_OVERRIDES[site],
  };
}

const X_IDS = postIds('x');
const YOUTUBE_IDS = videoIds('youtube');

/*
 * Flows Yobi runs itself for a link pasted alone in a bot's private chat: never saved, listed or
 * edited, and not commands anyone types. A pasted X, Threads, Instagram or Facebook post (or
 * Instagram story) is forwarded — its text and its media, the best quality the chat takes — and a
 * pasted YouTube video gets the download menu, with a summary button. A link with anything else
 * written beside it is a request for the agent. The desktop chat runs twins of these, in any mode,
 * the agent's too.
 *
 * The buttons under them are fixed steps as well, never the agent, since a clear action does not
 * need it: "analyze" reads the post and its replies
 * and has one model call sum them up; "summary" uses the YouTube template from Settings.
 */
export const X_FORWARD_FLOW_ID = X_IDS.forward;
export const YTDL_FLOW_ID = YOUTUBE_IDS.menu;
/** "Analyze" under a forwarded post: its text and replies, summed up in one model call. */
export const X_ANALYZE_FLOW_ID = X_IDS.analyze;
/** The desktop chat's counterpart of the X forward: the post and its media, shown in the conversation. */
export const X_POST_FLOW_ID = X_IDS.desktopPost;
/** The desktop chat's "download" under a shown post: its media saved in the downloads folder. */
export const X_SAVE_FLOW_ID = X_IDS.desktopSave;
/** The desktop chat's counterpart of the YouTube menu: the same choices, answered in the conversation. */
export const YTDL_CHAT_FLOW_ID = YOUTUBE_IDS.desktopMenu;
/** The desktop chat's "analyze" under a shown post, answered in the conversation. */
export const X_ANALYZE_CHAT_FLOW_ID = X_IDS.desktopAnalyze;
