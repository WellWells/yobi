/**
 * Where a built-in command run was started from.
 *
 * A bot run has nobody sitting at the desktop, which changes two things: it must never
 * deliver into the app's temporary chat (the requester would get nothing back), and it must
 * never wait on a native confirmation dialog (the queue has no hard timeout, so an
 * unanswered dialog stalls every task behind it).
 */
export type CommandOrigin = 'app' | 'bot';
