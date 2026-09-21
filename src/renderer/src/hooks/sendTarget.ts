export interface SendTarget {
  /** Empty means this turn belongs to no file on disk. */
  conversationPath: string;
  /** Close the open conversation so the incognito thread is what the user watches. */
  releaseSelectedFile: boolean;
}

/**
 * Works out which conversation a composer send belongs to.
 *
 * Temporary chat has its own view, but selecting a file does not leave it and the toggle is
 * only hidden — the keyboard shortcut still fires. A send made in that state used to keep
 * pointing at the open conversation, so the provider thread was resumed for a reply that was
 * then thrown away, and the pending bubble was filed under a file whose view does not render
 * pending turns. Releasing the selection puts the user in front of the thread they are
 * actually talking to.
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
