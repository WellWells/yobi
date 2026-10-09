export interface SendTarget {
  /** Empty means this turn belongs to no file on disk. */
  conversationPath: string;
  /** Close the open conversation so the incognito thread is what the user watches. */
  releaseSelectedFile: boolean;
}

/**
 * Works out which conversation a composer send belongs to. Selecting a file does not leave
 * temporary chat (and its shortcut still fires), so in temporary chat the open file is released
 * and the send goes to the temporary thread, not to a file whose provider thread would be resumed
 * and whose view never shows the pending turn.
 */
export function resolveSendTarget(args: {
  selectedFilePath: string;
  tempChatMode: boolean;
}): SendTarget {
  if (!args.tempChatMode) {
    return { conversationPath: args.selectedFilePath, releaseSelectedFile: false };
  }
  return { conversationPath: '', releaseSelectedFile: args.selectedFilePath !== '' };
}
