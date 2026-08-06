const OA_MESSAGE_BASE = 'https://line.me/R/oaMessage';
const ADD_FRIEND_BASE = 'https://line.me/R/ti/p';

export const LINE_PAIR_COMMAND = '/pair';

export function buildLinePairingLink(basicId: string, code: string): string {
  const id = basicId.trim();
  const pairCode = code.trim();
  if (!id || !pairCode) return '';
  const message = encodeURIComponent(`${LINE_PAIR_COMMAND} ${pairCode}`);
  return `${OA_MESSAGE_BASE}/${encodeURIComponent(id)}/?${message}`;
}

export function buildLineAddFriendLink(basicId: string): string {
  const id = basicId.trim();
  if (!id) return '';
  return `${ADD_FRIEND_BASE}/${encodeURIComponent(id)}`;
}
