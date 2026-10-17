import type { FlowDefinition } from '../types';
import { isVideoMenuMatch, parseQualityToken } from '../ytdl';
import {
  postAnalyzeChatFlow, postAnalyzeFlow, postAudioChatFlow, postAudioFlow, postForwardFlow, postSaveFlow, postViewFlow,
} from '../builtin/postFlows';
import { youtubeSummaryPrompt } from '../builtin/prompts';
import { videoMenuChatFlow, videoMenuFlow } from '../builtin/videoFlows';
import { postIds, videoIds } from './ids';
import { LINK_SITE_ROWS, matchLink, matchPostLink, rowById } from './rows';
import type { LinkSiteId, PostRow, VideoRow } from './types';

export { LINK_SITE_ROWS, matchLink, matchPostLink, rowById };

/** What a built-in needs from the app to be built: its strings, the app language, the summary template. */
export interface BuiltinBuildContext {
  /** The app-language string for an i18n key, `{{name}}` filled from `vars`. */
  t(key: string, vars?: Record<string, string>): string;
  locale: string;
  /** The YouTube summary template from Settings, or the app language's built-in one when empty. */
  summaryTemplate(): string;
}

export type BuiltinSurface = 'bot' | 'desktop';
export type BuiltinAction = 'forward' | 'analyze' | 'audio' | 'post' | 'save' | 'analyzeChat' | 'audioChat' | 'menu' | 'menuChat';

export interface BuiltinEntry {
  id: string;
  /** The site whose links this built-in runs for. */
  site: LinkSiteId;
  action: BuiltinAction;
  surface: BuiltinSurface;
  /** The bots' command for a bot built-in; a desktop built-in's command is its id. */
  command: string;
  build(ctx: BuiltinBuildContext): FlowDefinition;
}

/* A built-in's name says which site it is for: the row's own label, never translated. */
function postEntries(row: PostRow): BuiltinEntry[] {
  const site = row.id;
  const ids = postIds(site);
  const vars = { site: row.label };
  const style = row.pushes ? 'pushes' : 'replies';
  return [
    {
      id: ids.forward, site, action: 'forward', surface: 'bot', command: ids.cmdForward,
      build: (ctx) => postForwardFlow(ids, ctx.t('flow.builtin.post.forward', vars), ctx.t('x.analyze.button')),
    },
    {
      id: ids.analyze, site, action: 'analyze', surface: 'bot', command: ids.cmdAnalyze,
      build: (ctx) => postAnalyzeFlow(ids, ctx.t('flow.builtin.post.analyze', vars), ctx.locale, style, row.analysisReplies),
    },
    {
      id: ids.desktopPost, site, action: 'post', surface: 'desktop', command: ids.desktopPost,
      build: (ctx) => postViewFlow(ids, ctx.t('flow.builtin.post.post', vars)),
    },
    {
      id: ids.desktopSave, site, action: 'save', surface: 'desktop', command: ids.desktopSave,
      build: (ctx) => postSaveFlow(ids, ctx.t('flow.builtin.post.save', vars)),
    },
    {
      id: ids.desktopAnalyze, site, action: 'analyzeChat', surface: 'desktop', command: ids.desktopAnalyze,
      build: (ctx) => postAnalyzeChatFlow(ids, ctx.t('flow.builtin.post.analyzeChat', vars), ctx.locale, style, row.analysisReplies),
    },
    {
      id: ids.audio, site, action: 'audio', surface: 'bot', command: ids.cmdAudio,
      build: (ctx) => postAudioFlow(ids, ctx.t('flow.builtin.post.mp3', vars)),
    },
    {
      id: ids.desktopAudio, site, action: 'audioChat', surface: 'desktop', command: ids.desktopAudio,
      build: (ctx) => postAudioChatFlow(ids, ctx.t('flow.builtin.post.mp3', vars)),
    },
  ];
}

/* A video built-in has its "summary" branch only when the row's menu offers one. */
function videoEntries(row: VideoRow): BuiltinEntry[] {
  const site = row.id;
  const ids = videoIds(site);
  const vars = { site: row.label };
  const summary = (ctx: BuiltinBuildContext): string | null => (row.summary ? youtubeSummaryPrompt(ctx.summaryTemplate()) : null);
  return [
    {
      id: ids.menu, site, action: 'menu', surface: 'bot', command: ids.cmdMenu,
      build: (ctx) => videoMenuFlow(ids, ctx.t('flow.builtin.video.menu', vars), summary(ctx)),
    },
    {
      id: ids.desktopMenu, site, action: 'menuChat', surface: 'desktop', command: ids.desktopMenu,
      build: (ctx) => videoMenuChatFlow(ids, ctx.t('flow.builtin.video.menu', vars), summary(ctx)),
    },
  ];
}

/** Every built-in: each row its own set, ids derived from the row's site. */
export const BUILTIN_ENTRIES: readonly BuiltinEntry[] = LINK_SITE_ROWS.flatMap((row) =>
  row.shape === 'post' ? postEntries(row) : videoEntries(row));

const BY_ID = new Map(BUILTIN_ENTRIES.map((entry) => [entry.id, entry]));

export function builtinById(flowId: string): BuiltinEntry | undefined {
  return BY_ID.get(flowId);
}

export function isBuiltinFlowId(flowId: string): boolean {
  return BY_ID.has(flowId);
}

export function isDesktopBuiltinFlowId(flowId: string): boolean {
  return builtinById(flowId)?.surface === 'desktop';
}

function entryFor(site: LinkSiteId, action: BuiltinAction): BuiltinEntry | null {
  return BUILTIN_ENTRIES.find((e) => e.site === site && e.action === action) ?? null;
}

/** A site's built-in for an action (its desktop "save", its "analyze"), or null when it has none. */
export function siteActionId(site: LinkSiteId, action: BuiltinAction): string | null {
  return entryFor(site, action)?.id ?? null;
}

/**
 * The built-in a stored command runs. Stored conversation files may carry X's ids over another
 * post site's link (`c`, and button lines such as `/builtin-x-save <a Threads link>`): a post
 * built-in handed another post site's link runs the same action, on the same surface, of the
 * link's own site. Anything else is returned unchanged.
 */
export function canonicalBuiltin(id: string, input: string): string {
  const entry = builtinById(id);
  if (!entry) return id;
  const match = matchPostLink(input);
  if (!match || rowById(entry.site)?.shape !== 'post' || match.ref.site === entry.site) return id;
  return entryFor(match.ref.site, entry.action)?.id ?? id;
}

/**
 * The word the "analyze" button puts after the link — also the line LINE lists for it. Only this
 * exact word: any other words beside a link are a question for the agent.
 */
const ANALYZE_WORD = 'analyze';

function isAnalyzeWord(prompt: string): boolean {
  return prompt.trim().toLowerCase() === ANALYZE_WORD;
}

/** What the "analyze" button sends: the post's link and the word, exactly as if typed. */
export function xAnalyzeInput(link: string): string {
  return `${link} ${ANALYZE_WORD}`;
}

/**
 * Whether the words beside a post link ask for its MP3: one of the video menu's MP3 words alone
 * (`mp3`, `audio`…, `parseQualityToken`), so a post takes the same words a video does.
 */
function isMp3Word(prompt: string): boolean {
  return parseQualityToken(prompt) === 'mp3';
}

/** What the "MP3" button under a forwarded post sends: its link and the word, exactly as if typed. */
export function postAudioInput(link: string): string {
  return `${link} mp3`;
}

const ACTIONS: Record<BuiltinSurface, { forward: BuiltinAction; analyze: BuiltinAction; audio: BuiltinAction; menu: BuiltinAction }> = {
  bot: { forward: 'forward', analyze: 'analyze', audio: 'audio', menu: 'menu' },
  desktop: { forward: 'post', analyze: 'analyzeChat', audio: 'audioChat', menu: 'menuChat' },
};

/**
 * The built-in a message runs on `surface`: a post link alone forwards or shows the post,
 * followed by exactly "analyze" analyzes it, by an MP3 word turns its videos into MP3s; a video
 * link alone, or with only the menu's own words, gets the menu. Anything else written beside the
 * link is a question for the agent: null.
 */
function linkEntryFor(text: string, surface: BuiltinSurface): BuiltinEntry | null {
  const match = matchLink(text);
  if (!match) return null;
  const actions = ACTIONS[surface];
  if (match.ref.shape === 'video') return isVideoMenuMatch(match) ? entryFor(match.ref.site, actions.menu) : null;
  if (!match.prompt) return entryFor(match.ref.site, actions.forward);
  if (isMp3Word(match.prompt)) return entryFor(match.ref.site, actions.audio);
  return isAnalyzeWord(match.prompt) ? entryFor(match.ref.site, actions.analyze) : null;
}

/**
 * The built-in a desktop chat message runs whatever mode the composer is in, as a bot chat does:
 * a post link alone shows the post (followed by "analyze", analyzes it), a video link alone (or
 * with the menu's own words) the download menu. Anything else written beside the link is a
 * question, and null.
 */
export function desktopLinkFlowFor(text: string): string | null {
  return linkEntryFor(text, 'desktop')?.id ?? null;
}

/** The desktop "analyze" for a shown post's link: its own site's, or null when it is not a post. */
export function desktopAnalyzeIdFor(link: string): string | null {
  const match = matchPostLink(link);
  return match ? siteActionId(match.ref.site, 'analyzeChat') : null;
}

/**
 * The commands a turn's buttons may send: its own, and for a shown post the download and the MP3
 * of the post's site. A stored turn may carry X's ids over another site's link (`builtin-x-post`
 * over a Threads link, its button `/builtin-x-save …`): X's entries stay, so that pair passes, and `canonicalBuiltin` runs it as the link's own site's. Only built-ins Yobi wrote — a
 * hand-edited file must not be able to start anything else.
 */
export function turnButtonCommands(command: string): string[] {
  const entry = builtinById(command);
  if (entry?.action !== 'post') return [command];
  const offered = [entryFor(entry.site, 'save'), entryFor(entry.site, 'audioChat')];
  return [command, ...offered.flatMap((e) => (e ? [e.id] : []))];
}

/** The shape the bots run a flow command by; a built-in is open to everyone paired. */
export interface BuiltinLinkCommand {
  flowId: string;
  command: string;
  description: string;
  inputVariable: string;
  access: 'all';
  allowedUserIds: string[];
}

/**
 * The built-in that takes this private message, or null: it goes to the agent. A built-in's
 * button is routed by its line too, so pressing it is exactly typing it.
 */
export function linkCommandFor(text: string): BuiltinLinkCommand | null {
  const entry = linkEntryFor(text, 'bot');
  if (!entry) return null;
  return { flowId: entry.id, command: entry.command, description: '', inputVariable: 'input', access: 'all', allowedUserIds: [] };
}

/** How many links one overheard message may start: a pasted list must not queue a run per line. */
export const OVERHEARD_LINKS_MAX = 5;

/**
 * The built-ins a group message that does not mention the bot runs, each with its input. The bot
 * only overhears it, so nothing goes to the agent: the message's own built-in when it has one (a
 * link alone, with "analyze", with the menu's words), else each distinct link in it alone, whatever
 * is written around them. Empty when it carries no link a built-in reads.
 */
export function overheardLinkCommands(text: string): Array<{ command: BuiltinLinkCommand; input: string }> {
  const own = linkCommandFor(text);
  if (own) return [{ command: own, input: text.trim() }];
  const seen = new Set<string>();
  const runs: Array<{ command: BuiltinLinkCommand; input: string }> = [];
  for (const token of text.split(/\s+/)) {
    const url = matchLink(token)?.ref.url;
    const command = url ? linkCommandFor(token) : null;
    if (!url || !command || seen.has(url)) continue;
    seen.add(url);
    runs.push({ command, input: token });
  }
  return runs.slice(0, OVERHEARD_LINKS_MAX);
}
