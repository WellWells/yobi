/*
 * Programs Yobi runs but does not ship (see `shared/managedTools.ts`). yt-dlp and FFmpeg keep their
 * own installer in `youtubeDownload/` (a signed checksum file, a pair installed together, a nightly
 * channel) and share the download, checksum, process and rename pieces kept here.
 */
export {
  checkManagedToolUpdate, installManagedTool, removeManagedTool, setManagedToolCustomPath, startManagedToolUpdates,
  stopManagedToolUpdates,
} from './toolInstaller';
export { resolveTool, toolRunEnv } from './toolResolve';
export { managedExecutable, onManagedToolState, reloadManagedTools, snapshot as managedToolState, toolRoot } from './toolStore';
export { toolSpec } from './specs';
