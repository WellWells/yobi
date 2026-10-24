/** LINE's names for the shared string-id pairing (`botChat/pairingState.ts`). */
export {
  normalizeBotPairingState as normalizeLinePairingState,
  hasBotPairedUser as hasLinePairedUser,
  findBotPairedDisplayName as findLinePairedDisplayName,
  issueBotPairingCode as issueLinePairingCode,
  revokeBotPairingCode as revokeLinePairingCode,
  unpairBotUser as unpairLineUser,
  consumeBotPairingCode as consumeLinePairingCode,
  createBotPairingBridge as createLinePairingBridge,
} from '../botChat/pairingState';
export type { BotPairingUserProfile as LinePairingUserProfile } from '../botChat/pairingState';
