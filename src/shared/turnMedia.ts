import { UPLOADABLE_EXTENSIONS } from './attachmentFormats';

/**
 * Photos, videos and audio a turn saved on this computer (`fl`), shown in the conversation. The
 * renderer cannot read a local file (its CSP allows only `'self'` and `data:`), so main serves them
 * on a scheme of its own — and only files that are a photo, a video or audio by their extension.
 */
export const TURN_MEDIA_SCHEME = 'yobi-media';

export type TurnMediaKind = 'image' | 'video' | 'audio';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);
// What Yobi's own downloads write: MP3 from every site, M4A from a stream's audio track.
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a']);

// Documents that open in a viewer or an editor, never in an interpreter.
const OPENABLE_TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json']);

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
};

function extensionOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function turnMediaKind(filePath: string): TurnMediaKind | null {
  const extension = extensionOf(filePath);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  return null;
}

export function turnMediaMimeType(filePath: string): string {
  return MIME_TYPES[extensionOf(filePath)] ?? 'application/octet-stream';
}

/**
 * An absolute path on this computer. Not a network share (`\\host\x`, `//host/x`): these paths ride
 * in a file that can be imported or edited by hand, and just reading a share hands its host this
 * Windows account's credentials. Not an NTFS stream either (`x.exe:y.pdf`), whose extension says
 * nothing about what opens.
 */
export function isLocalFilePath(filePath: string): boolean {
  if (filePath.includes('\0')) return false;
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return !filePath.slice(2).includes(':');
  return /^\/(?![\\/])/.test(filePath);
}

/**
 * Whether a click may hand this file to the system's default app. A list of what is safe, not of
 * what is not: the path may come from a hand-edited conversation, a click must never run a
 * program, and no blocklist knows what an installed interpreter adds (`.py` runs once Python is in).
 */
export function turnFileOpens(filePath: string): boolean {
  if (!isLocalFilePath(filePath)) return false;
  const extension = extensionOf(filePath);
  return turnMediaKind(filePath) !== null
    || UPLOADABLE_EXTENSIONS.has(extension)
    || OPENABLE_TEXT_EXTENSIONS.has(extension);
}

/** The URL the renderer loads a saved photo, video or audio file from. */
export function turnMediaUrl(filePath: string): string {
  return `${TURN_MEDIA_SCHEME}://file/${encodeURIComponent(filePath)}`;
}

/** The absolute path a media URL names, or null when it is not one of ours or not a media kind. */
export function turnMediaPath(url: string): string | null {
  const prefix = `${TURN_MEDIA_SCHEME}://file/`;
  if (!url.startsWith(prefix)) return null;
  let filePath: string;
  try {
    filePath = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  return isLocalFilePath(filePath) && turnMediaKind(filePath) ? filePath : null;
}
