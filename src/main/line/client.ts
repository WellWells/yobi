import { LineBotClient } from '@line/bot-sdk';

export interface LineBotInfo {
  basicId: string;
  displayName: string;
  // 'chat' means the Official Account's Chat feature is On, which is what lets
  // LINE auto-reply on the bot's behalf. It is not the auto-reply toggle itself.
  chatMode: 'chat' | 'bot';
}

// Thin wrapper over the LINE Messaging API client, exposing only what Yobi
// needs. Reply tokens expire (~30s, single use) so async AI results are always
// delivered via push, keyed by userId. Synchronous answers use replyText, which
// is free — pushes are metered against the account's monthly quota, so replying
// to unpaired chatter with a push would let anyone drain it.
export interface LineClient {
  pushText: (userId: string, text: string) => Promise<void>;
  // LINE renders images from a public HTTPS URL it fetches itself; there is no
  // upload endpoint, so local files can never be sent this way.
  pushImage: (userId: string, imageUrl: string) => Promise<void>;
  replyText: (replyToken: string, text: string) => Promise<void>;
  getBotInfo: () => Promise<LineBotInfo>;
  // undefined when the endpoint is unknown — LINE answers 404 while no webhook
  // URL is registered on the channel.
  getWebhookActive: () => Promise<boolean | undefined>;
  getDisplayName: (userId: string) => Promise<string | undefined>;
}

export function createLineClient(channelAccessToken: string): LineClient {
  const client = LineBotClient.fromChannelAccessToken({ channelAccessToken });
  return {
    pushText: async (userId, text) => {
      await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
    },
    pushImage: async (userId, imageUrl) => {
      await client.pushMessage({
        to: userId,
        messages: [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }],
      });
    },
    replyText: async (replyToken, text) => {
      await client.replyMessage({ replyToken, messages: [{ type: 'text', text }] });
    },
    getBotInfo: async () => {
      const info = await client.getBotInfo();
      return { basicId: info.basicId, displayName: info.displayName, chatMode: info.chatMode };
    },
    getWebhookActive: async () => {
      try {
        const endpoint = await client.getWebhookEndpoint();
        return endpoint.active;
      } catch {
        return undefined;
      }
    },
    getDisplayName: async (userId) => {
      try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
      } catch {
        return undefined;
      }
    },
  };
}
