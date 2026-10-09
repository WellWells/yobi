/*
 * An answer that published an artifact is rebuilt from the conversation endpoint, in block order;
 * the copy control alone returns only the chat line.
 */

export type ClaudeLeafFetch =
  | { ok: true; content: unknown[] }
  | { ok: false; reason: string };

/**
 * The latest message of one conversation. Runs in the page and never throws: `{ ok: true, leaf }`
 * or `{ ok: false, reason }`. `conversation` empty means the one in the address bar.
 */
export const CLAUDE_CONVERSATION_LEAF_JS = `async function claudeConversationLeaf(conversation) {
  try {
    var org = '';
    var pairs = (document.cookie || '').split('; ');
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].indexOf('lastActiveOrg=') === 0) org = decodeURIComponent(pairs[i].slice('lastActiveOrg='.length));
    }
    if (!conversation) {
      var path = location.pathname.split('/');
      conversation = path[1] === 'chat' ? path[2] : '';
    }
    if (!org || !conversation) return { ok: false, reason: 'no organization or conversation id' };
    var url = '/api/organizations/' + encodeURIComponent(org) + '/chat_conversations/' + encodeURIComponent(conversation)
      + '?tree=True&rendering_mode=messages&render_all_tools=true';
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status };
    var data = await res.json();
    var messages = (data && data.chat_messages) || [];
    for (var j = 0; j < messages.length; j++) {
      if (messages[j].uuid === data.current_leaf_message_uuid) return { ok: true, leaf: messages[j] };
    }
    return { ok: false, reason: 'no latest message' };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}`;

/** The reply in the address bar's conversation, for the artifact rebuild. Never throws. */
export const CLAUDE_FETCH_LEAF_JS = `(async function claudeFetchLeaf() {
  ${CLAUDE_CONVERSATION_LEAF_JS}
  var read = await claudeConversationLeaf('');
  if (!read.ok) return read;
  if (read.leaf.sender !== 'assistant') return { ok: false, reason: 'latest message is not an answer' };
  return { ok: true, content: read.leaf.content || [] };
})()`;

interface ContentBlock {
  type?: unknown;
  name?: unknown;
  text?: unknown;
  input?: unknown;
}

const PLAIN_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text']);

function fenceFor(body: string): string {
  let fence = '```';
  while (body.includes(fence)) fence += '`';
  return fence;
}

function formatArtifact(filePath: string, body: string): string {
  const name = filePath.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const trimmed = body.replace(/\s+$/, '');
  if (!ext || PLAIN_TEXT_EXTENSIONS.has(ext)) return trimmed;
  const fence = fenceFor(trimmed);
  return `${fence}${ext}\n${trimmed}\n${fence}`;
}

function replaceOnce(source: string, search: string, replacement: string): string | null {
  const at = source.indexOf(search);
  if (!search || at < 0) return null;
  return `${source.slice(0, at)}${replacement}${source.slice(at + search.length)}`;
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  return typeof input[key] === 'string' ? (input[key] as string) : null;
}

/**
 * The answer as Claude wrote it, artifacts inlined. `null` when the reply published no artifact
 * whose text is known — the copied chat text is then already the whole answer.
 */
export function composeClaudeAnswer(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const files = new Map<string, string>();
  const parts: string[] = [];
  let artifacts = 0;

  for (const raw of content as ContentBlock[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type === 'text') {
      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (text) parts.push(text);
      continue;
    }
    if (raw.type !== 'tool_use' || !raw.input || typeof raw.input !== 'object') continue;
    const input = raw.input as Record<string, unknown>;
    const path = stringField(input, 'path');

    if (raw.name === 'create_file' && path !== null) {
      const text = stringField(input, 'file_text');
      if (text !== null) files.set(path, text);
      continue;
    }
    if (raw.name === 'str_replace' && path !== null && files.has(path)) {
      const edited = replaceOnce(files.get(path) ?? '', stringField(input, 'old_str') ?? '', stringField(input, 'new_str') ?? '');
      if (edited !== null) files.set(path, edited);
      continue;
    }
    if (raw.name === 'Artifact') {
      const filePath = stringField(input, 'file_path');
      const body = filePath === null ? undefined : files.get(filePath);
      if (filePath === null || body === undefined) continue;
      artifacts += 1;
      parts.push(formatArtifact(filePath, body));
    }
  }

  return artifacts > 0 ? parts.join('\n\n') : null;
}
