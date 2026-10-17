const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'];

const VIDEO_ID = /^[\w-]{11}$/;

export function extractYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const vParam = parsed.searchParams.get('v');
    if (vParam && VIDEO_ID.test(vParam)) return vParam;
    const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (match) return match[1];
  }

  return null;
}

export function youtubeThumbnailUrl(url: string): string {
  const id = extractYoutubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

export function isYoutubeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!YOUTUBE_HOSTS.includes(host)) return false;
  return extractYoutubeVideoId(url) !== null;
}

/**
 * The video id of a link that is safe to hand to a downloader: http(s) only, a YouTube host, no
 * credentials and no port. Stricter than `extractYoutubeVideoId`, which also reads a link a user
 * pasted for a summary.
 */
export function strictYoutubeVideoId(text: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(text.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!YOUTUBE_HOSTS.includes(host)) return null;
  return extractYoutubeVideoId(parsed.href);
}

/** A link on YouTube Music (`music.youtube.com`): someone after the song, not the picture. */
export function isYoutubeMusicUrl(text: string): boolean {
  try {
    return new URL(text.trim()).hostname.toLowerCase() === 'music.youtube.com';
  } catch {
    return false;
  }
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
