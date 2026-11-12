// Chromium always has userAgentData here (the App's pages are secure contexts). The fallback is
// the user agent string, not `navigator.platform`, which is deprecated.
const raw = (
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.userAgent
  ?? ''
).toLowerCase();

/** The OS in Node's `process.platform` spelling, so renderer checks share main's tables. */
export const hostPlatform: 'darwin' | 'win32' | 'linux' = raw.includes('mac')
  ? 'darwin'
  : raw.includes('win') ? 'win32' : 'linux';

/** `data-platform` on the root, for stylesheet rules that apply to one OS (the Windows scrollbar). */
export function markHostPlatform(root: HTMLElement = document.documentElement): void {
  root.dataset.platform = hostPlatform;
}
