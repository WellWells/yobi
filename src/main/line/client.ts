import { LineBotClient } from '@line/bot-sdk';

export interface LineBotInfo {
  basicId: string;
  displayName: string;
  chatMode: 'chat' | 'bot';
}

export interface LineClient {
  pushText: (userId: string, text: string) => Promise<void>;
  pushImage: (userId: string, imageUrl: string) => Promise<void>;
  replyText: (replyToken: string, text: string) => Promise<void>;
  getBotInfo: () => Promise<LineBotInfo>;
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
