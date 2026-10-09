/**
 * Per-account bot permissions: how much a message may use (agent), who may run /search and reach
 * the web, read this computer, use which connectors, and (Telegram) run the admin commands. One resolver decides;
 * the token rules live in `shared/botPermissions.ts` so the settings page derives the same view.
 */
export { normalizeBotPermissions, telegramAdminMirror } from './normalize';
export type { BotPermissionsSource, NormalizedBotPermissions } from './normalize';
export {
  computeBotRights,
  getBotGrants,
  getBotRights,
  isBotUserPaired,
  isTelegramAdminGrant,
  pairedBotUserIds,
  pairedMenuAccess,
  pairedPrivateRights,
  botBuiltinAllowed,
} from './rights';
export type { BotMenuAccess } from './rights';
export { applyBotRunGrants, botChatPaired, botChatRights } from './runGrants';
export type { BotRunGrants } from './runGrants';
export { botAccessDeniedText } from './denial';
export type { BotDeniedCapability } from './denial';
export { dropBotPermissions, setBotPermissions, setTelegramAdmins } from './mutate';
