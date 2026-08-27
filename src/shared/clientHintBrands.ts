export interface UserAgentBrand {
  brand: string;
  version: string;
}

export const CHROME_BRAND = 'Google Chrome';
export const CHROMIUM_BRAND = 'Chromium';

const GREASE_BRAND: UserAgentBrand = { brand: 'Not;A=Brand', version: '8' };

export function withChromeBrand(brands: UserAgentBrand[]): UserAgentBrand[] {
  if (brands.some((entry) => entry.brand === CHROME_BRAND)) return brands;
  const chromium = brands.find((entry) => entry.brand === CHROMIUM_BRAND);
  if (!chromium) return brands;
  return [...brands, { brand: CHROME_BRAND, version: chromium.version }];
}

export function buildChromeBrands(chromeVersion: string): UserAgentBrand[] {
  const major = chromeVersion.split('.')[0] || chromeVersion;
  return withChromeBrand([GREASE_BRAND, { brand: CHROMIUM_BRAND, version: major }]);
}

export function formatBrandList(brands: UserAgentBrand[]): string {
  return brands.map((entry) => `"${entry.brand}";v="${entry.version}"`).join(', ');
}

export function parseBrandList(value: string): UserAgentBrand[] {
  const brands: UserAgentBrand[] = [];
  const entry = /"([^"]*)";\s*v="([^"]*)"/g;
  let match = entry.exec(value);
  while (match) {
    brands.push({ brand: match[1], version: match[2] });
    match = entry.exec(value);
  }
  return brands;
}

export function platformHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return 'Windows';
}
