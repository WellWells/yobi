import type { WebContents } from 'electron';
import { sendLog } from '../helpers';

/*
 * ChatGPT's temporary chat cannot draw (2026-10-19: it answers "switch to a normal chat"), so a
 * picture asked for privately is drawn in a normal chat that is deleted once it has been read.
 * Deleting is what the page's own "delete" does: PATCH the conversation with is_visible=false,
 * authorised by the bearer token of /api/auth/session. Measured the same day: 200
 * {"success":true}, then the conversation reads 404 conversation_deleted and leaves the list.
 */

const CONVERSATION_ID_RE = /^\/c\/([0-9a-f-]{36})(?:\/|$)/i;

/** The conversation id in a ChatGPT thread URL, or null for anything else. */
export function chatgptConversationId(threadUrl: string | null | undefined): string | null {
  if (!threadUrl) return null;
  try {
    const url = new URL(threadUrl);
    if (url.hostname !== 'chatgpt.com') return null;
    return CONVERSATION_ID_RE.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Page script: deletes one conversation; resolves `{ ok, status }` and never throws. */
export function buildChatgptDeleteScript(conversationId: string): string {
  return `
(async function chatgptDeleteConversation(id) {
  try {
    var session = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
    var token = session && session.accessToken;
    if (!token) return { ok: false, status: 'no session' };
    var res = await fetch('/backend-api/conversation/' + encodeURIComponent(id), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_visible: false })
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: String((e && e.message) || e) };
  }
})(${JSON.stringify(conversationId)})`;
}

/**
 * Deletes the ChatGPT conversation `threadUrl` names, from the page the worker is on (it must be
 * chatgpt.com: the call is same-origin with the page's cookies). True when ChatGPT confirmed it.
 */
export async function discardChatgptConversation(wc: WebContents, threadUrl: string | null): Promise<boolean> {
  const id = chatgptConversationId(threadUrl);
  if (!id) {
    sendLog('⚠️ [ChatGPT] No conversation to delete after the picture (the address had no conversation id)');
    return false;
  }
  if (wc.isDestroyed() || !wc.getURL().startsWith('https://chatgpt.com/')) {
    sendLog('⚠️ [ChatGPT] Conversation not deleted: the worker has left chatgpt.com');
    return false;
  }
  const result = await wc.executeJavaScript(buildChatgptDeleteScript(id), true).catch(() => null) as
    | { ok?: unknown; status?: unknown }
    | null;
  if (result?.ok === true) {
    sendLog('🗑️ [ChatGPT] Deleted the conversation the picture was drawn in');
    return true;
  }
  sendLog(`⚠️ [ChatGPT] Conversation not deleted (${String(result?.status ?? 'no answer')}) — it stays in ChatGPT's history`);
  return false;
}
