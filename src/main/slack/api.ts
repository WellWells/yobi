/**
 * The few Slack Web API methods the bot calls, over plain `fetch` (no SDK). The bot token
 * (`xoxb-`) does everything but opening Socket Mode, which takes the app-level token (`xapp-`).
 * A 429 waits the `Retry-After` Slack names and tries again, a few times at most.
 */
const API_BASE = 'https://slack.com/api';
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

export class SlackApiError extends Error {
  constructor(readonly method: string, readonly code: string) {
    super(`Slack ${method}: ${code}`);
    this.name = 'SlackApiError';
  }
}

/** Errors that mean the token itself is wrong: no retry helps. */
export const SLACK_AUTH_ERRORS: ReadonlySet<string> = new Set([
  'invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'not_allowed_token_type', 'missing_scope',
]);

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => Promise<Response>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A block of a message (Block Kit): only the shapes the bot sends. */
export type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'actions'; block_id?: string; elements: SlackButton[] }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

export interface SlackButton {
  type: 'button';
  text: { type: 'plain_text'; text: string; emoji?: boolean };
  action_id: string;
  value: string;
}

export interface SlackPostMessage {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  /** Answer inside this message's thread. */
  thread_ts?: string;
}

export interface SlackApi {
  authTest(): Promise<{ userId: string; botName: string; team: string; teamId: string }>;
  openConnection(): Promise<string>;
  postMessage(message: SlackPostMessage): Promise<{ ts: string; channel: string }>;
  updateMessage(channel: string, ts: string, text: string, blocks: SlackBlock[]): Promise<void>;
  /** The DM channel with this person (opened if need be). */
  openDm(userId: string): Promise<string>;
  userName(userId: string): Promise<string>;
  channelName(channelId: string): Promise<string>;
  /** Uploads a file into a channel (or its thread), the text as its comment. */
  uploadFile(channel: string, file: { name: string; data: Uint8Array }, comment?: string, threadTs?: string): Promise<void>;
}

export function createSlackApi(botToken: string, appToken: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): SlackApi {
  const dmChannels = new Map<string, string>();

  async function call<T>(method: string, body: Record<string, unknown>, options: { token?: string; form?: boolean } = {}, attempt = 0): Promise<T> {
    const token = options.token ?? botToken;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let payload: string;
    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString();
    } else {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(`${API_BASE}/${method}`, { method: 'POST', headers, body: payload });
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = Math.min(Math.max(Number(res.headers.get('retry-after') ?? 1), 1) * 1_000, MAX_RATE_LIMIT_WAIT_MS);
      await delay(waitMs);
      return call<T>(method, body, options, attempt + 1);
    }
    const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` })) as { ok?: boolean; error?: string } & T;
    if (!data.ok) throw new SlackApiError(method, data.error ?? `http_${res.status}`);
    return data;
  }

  return {
    authTest: async () => {
      const data = await call<{ user_id?: string; user?: string; team?: string; team_id?: string }>('auth.test', {});
      return { userId: data.user_id ?? '', botName: data.user ?? '', team: data.team ?? '', teamId: data.team_id ?? '' };
    },
    openConnection: async () => (await call<{ url?: string }>('apps.connections.open', {}, { token: appToken, form: true })).url ?? '',
    postMessage: async (message) => {
      const data = await call<{ ts?: string; channel?: string }>('chat.postMessage', { ...message, unfurl_links: false, unfurl_media: true });
      return { ts: data.ts ?? '', channel: data.channel ?? message.channel };
    },
    updateMessage: async (channel, ts, text, blocks) => {
      await call('chat.update', { channel, ts, text, blocks });
    },
    openDm: async (userId) => {
      const known = dmChannels.get(userId);
      if (known) return known;
      const data = await call<{ channel?: { id?: string } }>('conversations.open', { users: userId });
      const id = data.channel?.id ?? '';
      if (id) dmChannels.set(userId, id);
      return id;
    },
    userName: async (userId) => {
      const data = await call<{ user?: { real_name?: string; name?: string; profile?: { display_name?: string; real_name?: string } } }>(
        'users.info', { user: userId }, { form: true },
      );
      const user = data.user;
      return user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || '';
    },
    channelName: async (channelId) => {
      const data = await call<{ channel?: { name?: string } }>('conversations.info', { channel: channelId }, { form: true });
      return data.channel?.name ?? '';
    },
    uploadFile: async (channel, file, comment, threadTs) => {
      const target = await call<{ upload_url?: string; file_id?: string }>(
        'files.getUploadURLExternal', { filename: file.name, length: file.data.byteLength }, { form: true },
      );
      if (!target.upload_url || !target.file_id) throw new SlackApiError('files.getUploadURLExternal', 'no_upload_url');
      const put = await fetchImpl(target.upload_url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file.data });
      if (!put.ok) throw new SlackApiError('files.upload', `http_${put.status}`);
      await call('files.completeUploadExternal', {
        files: [{ id: target.file_id, title: file.name }],
        channel_id: channel,
        ...(comment ? { initial_comment: comment } : {}),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
    },
  };
}
