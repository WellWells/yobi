/*
 * The built-in flows Yobi runs itself for a pasted link, and the routing to them. The link sites,
 * their ids and the routing live in `linkSites/`; the flows themselves in `builtin/`. This file
 * keeps every name its importers use.
 */
export {
  X_ANALYZE_CHAT_FLOW_ID,
  X_ANALYZE_FLOW_ID,
  X_FORWARD_FLOW_ID,
  X_POST_FLOW_ID,
  X_SAVE_FLOW_ID,
  YTDL_CHAT_FLOW_ID,
  YTDL_FLOW_ID,
} from './linkSites/ids';
export {
  builtinById,
  canonicalBuiltin,
  desktopAnalyzeIdFor,
  desktopLinkFlowFor,
  isBuiltinFlowId,
  isDesktopBuiltinFlowId,
  linkCommandFor,
  overheardLinkCommands,
  postAudioInput,
  siteActionId,
  turnButtonCommands,
  xAnalyzeInput,
} from './linkSites/registry';
export type { BuiltinBuildContext } from './linkSites/registry';
export { xAnalyzePrompt, youtubeSummaryPrompt, ytCommandPrompt } from './builtin/prompts';
export { BOT_MODEL_VARIABLE, CHAT_MODEL_VARIABLE } from './builtin/steps';
