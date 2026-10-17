import { app } from 'electron';
import { setLargeUploader } from '../largeUpload';
import { createUploadSessionStore } from './sessionStore';
import { MtprotoUploader } from './uploader';
import type { MtprotoCredentials } from './uploader';

export { MtprotoUploader, credentialsReady } from './uploader';
export type { BotIdentity, MtprotoCredentials } from './uploader';

let instance: MtprotoUploader | null = null;

/**
 * Registers the MTProto uploader as the send path's large-file route. The credentials are read
 * on every call, so a saved or cleared API id, API hash or bot token takes effect at once.
 */
export function registerTelegramLargeUploader(deps: {
  getCredentials: () => MtprotoCredentials;
  log: (message: string) => void;
}): MtprotoUploader {
  instance = new MtprotoUploader({
    getCredentials: deps.getCredentials,
    sessions: createUploadSessionStore(),
    log: deps.log,
    openClient: async (credentials, session) => {
      const { openMtcuteClient } = await import('./mtcuteClient');
      return openMtcuteClient(credentials, session, deps.log);
    },
  });
  setLargeUploader(instance);
  const registered = instance;
  app.on('before-quit', () => { void registered.shutdown(); });
  return instance;
}

export function getTelegramLargeUploader(): MtprotoUploader | null {
  return instance;
}
