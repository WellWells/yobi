/**
 * Per-account bot permissions: how much a message may use (agent), who may run /search and reach
 * the web, read this computer, use which connectors, and (Telegram) run the admin commands. One resolver decides;
 * the token rules live in `shared/botPermissions.ts` so the settings page derives the same view.
 */
export { telegramAdminMirror } from './normalize';
export {
  computeBotRights,
  getBotGrants,
  getBotRights,
  isBotGroupPending,
  isBotUserBlocked,
  isBotUserPaired,
  isTelegramAdminGrant,
  pairedMenuAccess,
  botBuiltinAllowed,
  botChatAllowed,
  botDownloadAllowed,
  botFlowAdminAllowed,
  botFlowAllowed,
  computeBotFlowAdmin,
} from './rights';
export { applyBotRunGrants, botChatRights } from './runGrants';
export { botAccessDeniedText } from './denial';
export { notifyBotGroupJoined } from './groupApproval';
export { dropBotPermissions, setBotGroupPermissions, setBotPermissions, setBotUserBlocked } from './mutate';
