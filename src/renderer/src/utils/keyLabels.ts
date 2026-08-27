export const isMac = (
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.platform
  ?? ''
).toLowerCase().includes('mac');
