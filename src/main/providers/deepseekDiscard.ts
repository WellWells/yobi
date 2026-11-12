import type { WebContents } from 'electron';
import { sendLog } from '../helpers';
import { DEEPSEEK_ORIGIN } from './deepseekSession';

/*
 * DeepSeek has no temporary chat, so every new conversation (including chat and agent turns)
 * is deleted once its answer has been read, the way the page's own
 * sidebar "delete" does it: POST /api/v0/chat_session/delete {chat_session_ids:[id]}, authorised
 * by the bearer token in localStorage.userToken, as read in the page bundle; the
 * same bundle has a `delete_all`, which this must never call.
 * Success is not taken from the reply's codes: the conversation has to be gone from the list.
 */

const CONVERSATION_PATH_RE = /^\/a\/chat\/s\/([0-9a-f-]{36})\/?$/i;

/** The conversation id in a DeepSeek thread URL, or null for anything else. */
export function deepseekConversationId(threadUrl: string | null | undefined): string | null {
  if (!threadUrl) return null;
  try {
    const url = new URL(threadUrl);
    if (url.origin !== DEEPSEEK_ORIGIN) return null;
    return CONVERSATION_PATH_RE.exec(url.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Page script: deletes one conversation and checks the list; resolves `{ ok, status }`, never throws. */
export function buildDeepseekDeleteScript(conversationId: string): string {
  return `
(async function deepseekDeleteConversation(id) {
  try {
    var stored = JSON.parse(localStorage.getItem('userToken') || 'null');
    var token = stored && stored.value;
    if (!token) return { ok: false, status: 'no session' };
    var headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    var res = await fetch('/api/v0/chat_session/delete', {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({ chat_session_ids: [id] })
    });
    if (!res.ok) return { ok: false, status: res.status };
    var list = await (await fetch('/api/v0/chat_session/fetch_page?count=20', { credentials: 'include', headers: headers })).json();
    var sessions = (((list || {}).data || {}).biz_data || {}).chat_sessions;
    if (!Array.isArray(sessions)) return { ok: false, status: 'list unreadable' };
    var listed = sessions.some(function (s) { return s && s.id === id; });
    return { ok: !listed, status: listed ? 'still listed' : res.status };
  } catch (e) {
    return { ok: false, status: String((e && e.message) || e) };
  }
})(${JSON.stringify(conversationId)})`;
}

/**
 * Deletes the DeepSeek conversation the worker is on — the one this send just created. True only
 * when DeepSeek no longer lists it; anything else is logged and the conversation stays.
 */
export async function discardDeepseekConversation(wc: WebContents): Promise<boolean> {
  const url = wc.isDestroyed() ? '' : wc.getURL();
  const id = deepseekConversationId(url);
  if (!id) {
    sendLog('⚠️ [DeepSeek] Conversation not deleted: the page is not on a conversation');
    return false;
  }
  const result = await wc.executeJavaScript(buildDeepseekDeleteScript(id), true).catch(() => null) as
    | { ok?: unknown; status?: unknown }
    | null;
  if (result?.ok === true) {
    sendLog('🗑️ [DeepSeek] Deleted the conversation after reading the answer');
    return true;
  }
  sendLog(`⚠️ [DeepSeek] Conversation not deleted (${String(result?.status ?? 'no answer')}) — it stays in DeepSeek's history`);
  return false;
}
