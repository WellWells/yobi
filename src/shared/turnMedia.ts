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
  const absolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/');
  if (!absolute || filePath.includes('\0') || !turnMediaKind(filePath)) return null;
  return filePath;
}
