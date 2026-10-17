/**
 * What a send of a file over the Bot API's upload limit throws, in English for the log and the
 * step statistics; `localizeUserFacingError` words both for the person. The uploader's own error
 * goes to the log only.
 */
export const TELEGRAM_LARGE_UPLOAD_FAILED = 'Telegram large upload failed';

/** The file is over the Bot API's limit and large uploads are not set up: it was never tried. */
export const TELEGRAM_LARGE_UPLOAD_NOT_READY = 'Telegram large uploads are not set up';
