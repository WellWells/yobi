const raw = (
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.platform
  ?? ''
).toLowerCase();

/** The OS in Node's `process.platform` spelling, so renderer checks share main's tables. */
export const hostPlatform: 'darwin' | 'win32' | 'linux' = raw.includes('mac')
  ? 'darwin'
  : raw.includes('win') ? 'win32' : 'linux';
