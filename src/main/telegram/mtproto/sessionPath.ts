import * as path from 'node:path';
import { getConfigDir } from '../../configPaths';

/** Its own module so the factory reset can name the file without loading the session code. */
export const TELEGRAM_UPLOAD_SESSION_FILE = 'telegram-upload.session';

/** Next to config.json; never inside a folder a backup category sweeps up. */
export function telegramUploadSessionPath(): string {
  return path.join(getConfigDir(), TELEGRAM_UPLOAD_SESSION_FILE);
}
