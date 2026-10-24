/**
 * The few Discord HTTP API calls the bot makes (v10), over plain `fetch`: no SDK, so nothing is
 * added to the bundle and the token goes nowhere but `discord.com`. A 429 waits the time Discord
 * names and tries again, a few times at most.
 */
const API_BASE = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://github.com/WellWells/yobi, 1)';
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

export class DiscordApiError extends Error {
  constructor(readonly status: number, readonly code: number | undefined, message: string) {
    super(`Discord API ${status}${code !== undefined ? ` (${code})` : ''}: ${message}`);
    this.name = 'DiscordApiError';
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  guild_id?: string;
}

/** A row of buttons (component type 1) holding buttons (type 2). */
export interface DiscordButton {
  type: 2;
  /** 1 primary, 2 secondary, 5 link. */
  style: 1 | 2 | 5;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export interface DiscordMessagePayload {
  content?: string;
  components?: DiscordActionRow[];
  message_reference?: { message_id: string; fail_if_not_exists: false };
  /** Never ping anyone the text happens to name: the answer quotes what people wrote. */
  allowed_mentions?: { parse: never[]; replied_user?: boolean };
}

export interface DiscordFile {
  name: string;
  data: Uint8Array;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData }) => Promise<Response>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DiscordRest {
  getMe(): Promise<DiscordUser>;
  getChannel(channelId: string): Promise<DiscordChannel>;
  getGuildName(guildId: string): Promise<string>;
  /** The DM channel with this person (opened if need be). */
  openDm(userId: string): Promise<string>;
  sendMessage(channelId: string, payload: DiscordMessagePayload): Promise<{ id: string }>;
  sendFiles(channelId: string, payload: DiscordMessagePayload, files: readonly DiscordFile[]): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, payload: DiscordMessagePayload): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  triggerTyping(channelId: string): Promise<void>;
  /**
   * Answers a button press (`type` 6: acknowledged, the message stays; 7: the message is replaced;
   * 4 with `flags: 64`: a line only the presser sees).
   */
  answerInteraction(
    id: string,
    token: string,
    response: { type: 6 } | { type: 7; data: DiscordMessagePayload } | { type: 4; data: { content: string; flags: 64 } },
  ): Promise<void>;
}

const NO_PINGS = { parse: [] as never[], replied_user: false };

export function createDiscordRest(token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): DiscordRest {
  const dmChannels = new Map<string, string>();

  async function request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bot ${token}`, 'User-Agent': USER_AGENT };
    let payload: string | FormData | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(`${API_BASE}${path}`, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const data = await res.json().catch(() => ({})) as { retry_after?: number };
      const waitMs = Math.min(Math.max(Number(data.retry_after ?? 1), 0.05) * 1_000, MAX_RATE_LIMIT_WAIT_MS);
      await delay(waitMs);
      return request<T>(method, path, body, attempt + 1);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const error = (data ?? {}) as { code?: number; message?: string };
      throw new DiscordApiError(res.status, error.code, error.message ?? res.statusText);
    }
    return data as T;
  }

  const withNoPings = (payload: DiscordMessagePayload): DiscordMessagePayload => ({ allowed_mentions: NO_PINGS, ...payload });

  return {
    getMe: () => request<DiscordUser>('GET', '/users/@me'),
    getChannel: (channelId) => request<DiscordChannel>('GET', `/channels/${encodeURIComponent(channelId)}`),
    getGuildName: async (guildId) => (await request<{ name?: string }>('GET', `/guilds/${encodeURIComponent(guildId)}`)).name ?? '',
    openDm: async (userId) => {
      const known = dmChannels.get(userId);
      if (known) return known;
      const channel = await request<DiscordChannel>('POST', '/users/@me/channels', { recipient_id: userId });
      dmChannels.set(userId, channel.id);
      return channel.id;
    },
    sendMessage: (channelId, payload) => request<{ id: string }>('POST', `/channels/${encodeURIComponent(channelId)}/messages`, withNoPings(payload)),
    sendFiles: (channelId, payload, files) => {
      const form = new FormData();
      form.append('payload_json', JSON.stringify({
        ...withNoPings(payload),
        attachments: files.map((file, index) => ({ id: index, filename: file.name })),
      }));
      files.forEach((file, index) => {
        form.append(`files[${index}]`, new Blob([file.data as BlobPart]), file.name);
      });
      return request<{ id: string }>('POST', `/channels/${encodeURIComponent(channelId)}/messages`, form);
    },
    editMessage: async (channelId, messageId, payload) => {
      await request('PATCH', `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, payload);
    },
    deleteMessage: async (channelId, messageId) => {
      await request('DELETE', `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`);
    },
    triggerTyping: async (channelId) => {
      await request('POST', `/channels/${encodeURIComponent(channelId)}/typing`);
    },
    answerInteraction: async (id, interactionToken, response) => {
      await request('POST', `/interactions/${encodeURIComponent(id)}/${encodeURIComponent(interactionToken)}/callback`, response);
    },
  };
}
