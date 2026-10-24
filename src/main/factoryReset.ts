import { app, session } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { config, getDefaultConfig, saveConfig, wipeSensitiveConfig } from './config';
import { clearAllDataKeys } from './dataKeyStore';
import { clearAllAuthRecords } from './mcp/mcpTokenStore';
import { clearAllCalendars } from './calendar/calendarStore';
import { applyLaunchAtStartup, sendLog } from './helpers';
import { resetMetrics } from './metrics';
import { resetFlowMetrics } from './flowMetrics';
import { getOutputDir } from './files';
import { getFlowDataDir } from './flow';
import { HISTORY_DIR_NAME } from './history/historyPaths';
import { TRASH_DIR_NAME } from './conversationTrashPaths';
import { FOLDER_STATE_FILE } from './conversationFolderPaths';
import { NOTION_SYNC_DIR_NAME } from './notion/notionSyncStore';
import { deleteUserMemoryFiles } from './memory/memoryStore';
import { SITE_PARTITIONS } from './siteAccounts';
import { READER_PARTITIONS } from './sitePage';
import { revokeAllBotPairings } from './botDirectory';
import { reloadYtdlState, ytdlJobsRoot, ytdlToolsRoot } from './youtubeDownload';
import { downloadsLedgerPath } from './downloadsCache';
import { RAIL_CACHE_DIR_NAME } from './rail/railCache';
import { PTT_BOARDS_FILE } from './ptt/pttBoards';
import { clearWebHostPolicy } from './net/hostPolicyStore';
import { telegramUploadSessionPath } from './telegram/mtproto/sessionPath';
import { wipeGroupChatArchive } from './telegram/groupChatArchive';

const FACTORY_RESET_PARTITIONS = [
  'persist:gemini',
  'persist:url-parser',
  'persist:browser-flow',
  'persist:youtube',
  'persist:gmaps',
  // The sign-ins' partitions and the signed-out readers' (bilibili has one of each), each once.
  ...new Set([...SITE_PARTITIONS, ...READER_PARTITIONS]),
];

function getMarkerPath(): string {
  return path.join(app.getPath('userData'), 'factory-reset.pending');
}

export async function requestFactoryReset(): Promise<void> {
  await fs.writeFile(getMarkerPath(), 'pending', 'utf-8');
}

export async function applyPendingFactoryReset(): Promise<void> {
  const marker = getMarkerPath();
  if (!existsSync(marker)) return;
  await fs.rm(marker, { force: true }).catch(() => {});
  sendLog('♻️ Applying scheduled factory reset on a clean boot...');

  try {
    const defaults = getDefaultConfig();
    Object.assign(config, defaults);
    saveConfig(defaults);
    wipeSensitiveConfig();
    // Both live in their own files, so emptying the config does not touch them: the OAuth
    // tokens and the data-source keys would stay on disk under ids nothing references.
    clearAllAuthRecords();
    clearAllDataKeys();
    // Calendar subscriptions: secret .ics addresses, also in a file of their own.
    clearAllCalendars();
    // The bot's MTProto sign-in for big uploads, also in its own file: an auth key for the bot.
    await fs.rm(telegramUploadSessionPath(), { force: true }).catch(() => {});
    applyLaunchAtStartup(config.launchAtStartup, config.closeToTray);
    resetMetrics();
    resetFlowMetrics();

    await Promise.all(
      FACTORY_RESET_PARTITIONS.map((partition) =>
        session.fromPartition(partition).clearData().catch(() => {}),
      ),
    );

    await fs.rm(await getOutputDir(), { recursive: true, force: true }).catch(() => {});
    // The note that old bot conversations were filed into their folders: with no outputs, nothing was.
    await fs.rm(path.join(getFlowDataDir(), FOLDER_STATE_FILE), { force: true }).catch(() => {});
    await fs.rm(path.join(getFlowDataDir(), 'flow-checkpoints'), { recursive: true, force: true }).catch(() => {});
    // Versions of conversations and flows: the outputs and checkpoints above are gone, so must they be.
    await fs.rm(path.join(getFlowDataDir(), HISTORY_DIR_NAME), { recursive: true, force: true }).catch(() => {});
    // Recently Deleted: conversations the user already deleted, waiting out their 30 days.
    await fs.rm(path.join(getFlowDataDir(), TRASH_DIR_NAME), { recursive: true, force: true }).catch(() => {});
    // What Yobi knew of each Notion document's page; the pages in Notion are not touched.
    await fs.rm(path.join(getFlowDataDir(), NOTION_SYNC_DIR_NAME), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(app.getPath('userData'), 'flow-memory'), { recursive: true, force: true }).catch(() => {});
    await fs.rm(path.join(app.getPath('userData'), 'agent-runs'), { recursive: true, force: true }).catch(() => {});
    // The video download tools are programs Yobi fetched; "as installed" has none of them.
    await fs.rm(ytdlToolsRoot(), { recursive: true, force: true }).catch(() => {});
    await fs.rm(ytdlJobsRoot(), { recursive: true, force: true }).catch(() => {});
    reloadYtdlState();
    // Which downloads the Downloads/Yobi cleanup owns; the files there stay.
    await fs.rm(downloadsLedgerPath(), { force: true }).catch(() => {});
    // Pasted posts' media and videos' covers the chat showed; the conversations are gone too.
    await fs.rm(path.join(app.getPath('userData'), 'chat-media'), { recursive: true, force: true }).catch(() => {});
    // Railway timetables the rail connector downloaded; any of them can be fetched again.
    await fs.rm(path.join(app.getPath('userData'), RAIL_CACHE_DIR_NAME), { recursive: true, force: true }).catch(() => {});
    // The PTT board directory (~13k boards); the next board lookup crawls it again.
    await fs.rm(path.join(app.getPath('userData'), PTT_BOARDS_FILE), { force: true }).catch(() => {});
    // Which sites refused Yobi's page reads; relearned from the next refusal.
    await clearWebHostPolicy();
    // Pairing proof lives outside config (the directory's pairedAt, and conversation keys for
    // older installs); left alone, the start-up restore re-pairs every old account as soon as
    // the same token is entered. Names stay so the kept flows' recipients remain readable.
    await revokeAllBotPairings();
    await fs.rm(path.join(getFlowDataDir(), 'bot-conversations.json'), { force: true }).catch(() => {});
    // Other people's group talk, kept for the bot's context and the daily summary step.
    await wipeGroupChatArchive().catch(() => {});
    await deleteUserMemoryFiles();

    sendLog('♻️ Factory reset applied — clean first-run state');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    sendLog(`⚠️ Factory reset hit an error (continuing startup): ${message}`);
  }
}
