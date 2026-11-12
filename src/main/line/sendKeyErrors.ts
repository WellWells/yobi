/**
 * A send's key refusals, worded as line-cli words them (`readySendKeys`), in one place so the
 * user-facing translation (`localizeUserFacingError`) matches exactly what the send threw.
 */
export const LINE_SEALING_OFF_TEXT = 'this chat does not use Letter Sealing; plain-text send is not supported yet';
export const LINE_GROUP_KEY_MISSING_TEXT = "the group's E2EE key is not cached locally; open this group once in the LINE app (that fetches its key), then retry";
export const LINE_CHAT_KEY_MISSING_TEXT = "recipient's E2EE public key is not cached locally; open this chat once in the LINE app (that exchanges keys), then retry";
