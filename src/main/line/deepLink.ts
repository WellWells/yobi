// LINE URL schemes. Unlike Telegram's `?start=PAYLOAD`, LINE cannot send a
// message on the user's behalf: oaMessage only pre-fills the input field, so the
// user still taps send. See https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/
const OA_MESSAGE_BASE = 'https://line.me/R/oaMessage';
const ADD_FRIEND_BASE = 'https://line.me/R/ti/p';

export const LINE_PAIR_COMMAND = '/pair';

// basicId looks like '@216ruxyz' and must be percent-encoded ('%40216ruxyz').
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
