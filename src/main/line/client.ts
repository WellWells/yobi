import { LineBotClient } from '@line/bot-sdk';
import type { messagingApi } from '@line/bot-sdk';

export interface LineBotInfo {
  basicId: string;
  displayName: string;
  chatMode: 'chat' | 'bot';
}

export interface LineClient {
  pushText: (userId: string, text: string) => Promise<void>;
  pushImage: (userId: string, imageUrl: string) => Promise<void>;
  /** LINE fetches both itself: an https mp4 (up to 200 MB) and an https jpeg/png preview (up to 1 MB). */
  pushVideo: (userId: string, videoUrl: string, previewUrl: string) => Promise<void>;
  pushFlex: (userId: string, message: messagingApi.FlexMessage) => Promise<void>;
  replyText: (replyToken: string, text: string) => Promise<void>;
  getBotInfo: () => Promise<LineBotInfo>;
  getWebhookActive: () => Promise<boolean | undefined>;
  getDisplayName: (userId: string) => Promise<string | undefined>;
  /** A group's name (multi-person chats have none). */
  getGroupName: (groupId: string) => Promise<string | undefined>;
  /** Someone's name as a group or multi-person chat shows it — works without them adding the bot as a friend. */
  getMemberName: (chatKind: 'group' | 'room', chatId: string, userId: string) => Promise<string | undefined>;
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
    pushVideo: async (userId, videoUrl, previewUrl) => {
      await client.pushMessage({
        to: userId,
        messages: [{ type: 'video', originalContentUrl: videoUrl, previewImageUrl: previewUrl }],
      });
    },
    pushFlex: async (userId, message) => {
      await client.pushMessage({ to: userId, messages: [message] });
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
    getGroupName: async (groupId) => {
      try {
        return (await client.getGroupSummary(groupId)).groupName;
      } catch {
        return undefined;
      }
    },
    getMemberName: async (chatKind, chatId, userId) => {
      try {
        const profile = chatKind === 'group'
          ? await client.getGroupMemberProfile(chatId, userId)
          : await client.getRoomMemberProfile(chatId, userId);
        return profile.displayName;
      } catch {
        return undefined;
      }
    },
  };
}
