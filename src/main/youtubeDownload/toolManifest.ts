/*
 * What the download tools are and where they come from. FFmpeg is pinned by digest (ffmpeg-static
 * publishes no checksums, so these are computed from the release files). yt-dlp follows the
 * latest release and is checked against its signed SHA2-256SUMS instead.
 */

export const FFMPEG_RELEASE = 'b6.1.1';
export const FFMPEG_VERSION = '6.1.1';

export interface PinnedAsset {
  /** The release file name, e.g. `ffmpeg-win32-x64.gz`. */
  name: string;
  bytes: number;
  sha256: string;
}

export interface YtdlpAsset {
  /** The release zip, e.g. `yt-dlp_win.zip`. */
  zip: string;
  /** The executable inside the zip, at its top level. */
  exe: string;
  /** About how large the zip is, for the size shown before downloading. */
  approxBytes: number;
}

export interface PlatformTools {
  key: string;
  ytdlp: YtdlpAsset;
  ffmpeg: PinnedAsset;
  ffprobe: PinnedAsset;
}

const FFMPEG_ASSETS: Record<string, { ffmpeg: PinnedAsset; ffprobe: PinnedAsset }> = {
  'win32-x64': {
    ffmpeg: { name: 'ffmpeg-win32-x64.gz', bytes: 29_581_307, sha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77' },
    ffprobe: { name: 'ffprobe-win32-x64.gz', bytes: 29_521_644, sha256: 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d' },
  },
  'darwin-x64': {
    ffmpeg: { name: 'ffmpeg-darwin-x64.gz', bytes: 25_296_431, sha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106' },
    ffprobe: { name: 'ffprobe-darwin-x64.gz', bytes: 25_239_438, sha256: 'd4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186' },
  },
  'darwin-arm64': {
    ffmpeg: { name: 'ffmpeg-darwin-arm64.gz', bytes: 19_246_198, sha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' },
    ffprobe: { name: 'ffprobe-darwin-arm64.gz', bytes: 19_207_077, sha256: 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be' },
  },
  'linux-x64': {
    ffmpeg: { name: 'ffmpeg-linux-x64.gz', bytes: 29_354_986, sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa' },
    ffprobe: { name: 'ffprobe-linux-x64.gz', bytes: 29_276_839, sha256: '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067' },
  },
  'linux-arm64': {
    ffmpeg: { name: 'ffmpeg-linux-arm64.gz', bytes: 25_568_691, sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0' },
    ffprobe: { name: 'ffprobe-linux-arm64.gz', bytes: 25_493_573, sha256: '2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8' },
  },
};

/** Executable names as each release zip's central directory lists them. */
const YTDLP_ASSETS: Record<string, YtdlpAsset> = {
  'win32-x64': { zip: 'yt-dlp_win.zip', exe: 'yt-dlp.exe', approxBytes: 18_087_041 },
  'darwin-x64': { zip: 'yt-dlp_macos.zip', exe: 'yt-dlp_macos', approxBytes: 53_923_637 },
  'darwin-arm64': { zip: 'yt-dlp_macos.zip', exe: 'yt-dlp_macos', approxBytes: 53_923_637 },
  'linux-x64': { zip: 'yt-dlp_linux.zip', exe: 'yt-dlp_linux', approxBytes: 40_516_244 },
  'linux-arm64': { zip: 'yt-dlp_linux_aarch64.zip', exe: 'yt-dlp_linux_aarch64', approxBytes: 40_213_537 },
};

const YTDLP_REPOS = {
  stable: 'yt-dlp/yt-dlp',
  nightly: 'yt-dlp/yt-dlp-nightly-builds',
} as const;

export const YTDLP_SUMS_FILE = 'SHA2-256SUMS';
export const YTDLP_SIG_FILE = 'SHA2-256SUMS.sig';

/** `win32-x64` and the like, or null when no pinned build exists for this machine. */
export function ytdlPlatformKey(platform: string = process.platform, arch: string = process.arch): string | null {
  const key = `${platform}-${arch}`;
  return FFMPEG_ASSETS[key] && YTDLP_ASSETS[key] ? key : null;
}

export function platformTools(key: string | null = ytdlPlatformKey()): PlatformTools | null {
  if (!key) return null;
  const ffmpeg = FFMPEG_ASSETS[key];
  const ytdlp = YTDLP_ASSETS[key];
  if (!ffmpeg || !ytdlp) return null;
  return { key, ytdlp, ffmpeg: ffmpeg.ffmpeg, ffprobe: ffmpeg.ffprobe };
}

/** Bytes downloaded by a full install: the yt-dlp zip plus both FFmpeg archives. */
export function toolsDownloadBytes(tools: PlatformTools | null): number {
  if (!tools) return 0;
  return tools.ytdlp.approxBytes + tools.ffmpeg.bytes + tools.ffprobe.bytes;
}

export function ffmpegAssetUrl(asset: PinnedAsset): string {
  return `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/${asset.name}`;
}

/** Redirects to `/releases/download/<version>/<file>`, which is how the latest version is found. */
export function ytdlpLatestUrl(nightly: boolean, file: string): string {
  return `https://github.com/${YTDLP_REPOS[nightly ? 'nightly' : 'stable']}/releases/latest/download/${file}`;
}

export function ytdlpReleaseUrl(nightly: boolean, version: string, file: string): string {
  return `https://github.com/${YTDLP_REPOS[nightly ? 'nightly' : 'stable']}/releases/download/${version}/${file}`;
}

/** `ffmpeg` → `ffmpeg.exe` on Windows. */
export function executableName(base: string, platform: string = process.platform): string {
  return platform === 'win32' ? `${base}.exe` : base;
}
