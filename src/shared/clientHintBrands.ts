export interface UserAgentBrand {
  brand: string;
  version: string;
}

export const CHROME_BRAND = 'Google Chrome';
export const CHROMIUM_BRAND = 'Chromium';

const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'] as const;
const GREASE_VERSIONS = ['8', '99', '24'] as const;
const BRAND_ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;

/**
 * Google Chrome's own brand list for a version: the GREASE entry and the order are seeded by the
 * major version (Chromium's `user_agent_utils.cc`), so the list Electron reports and the one built
 * here agree entry for entry. A full version ("152.0.7977.130") gives the full-version-list form.
 */
export function chromeBrandList(version: string): UserAgentBrand[] {
  const seed = Number.parseInt(version, 10) || 0;
  const full = version.includes('.');
  const greaseVersion = GREASE_VERSIONS[seed % 3];
  const grease = {
    brand: `Not${GREASE_CHARS[seed % 11]}A${GREASE_CHARS[(seed + 1) % 11]}Brand`,
    version: full ? `${greaseVersion}.0.0.0` : greaseVersion,
  };
  const order = BRAND_ORDERS[seed % 6];
  const list: UserAgentBrand[] = [];
  list[order[0]] = grease;
  list[order[1]] = { brand: CHROMIUM_BRAND, version };
  list[order[2]] = { brand: CHROME_BRAND, version };
  return list;
}

/** Electron's Chromium-only list as Google Chrome reports it; anything else stays as it is. */
export function withChromeBrand(brands: UserAgentBrand[]): UserAgentBrand[] {
  if (brands.some((entry) => entry.brand === CHROME_BRAND)) return brands;
  const chromium = brands.find((entry) => entry.brand === CHROMIUM_BRAND);
  if (!chromium) return brands;
  return chromeBrandList(chromium.version);
}

export function buildChromeBrands(chromeVersion: string): UserAgentBrand[] {
  return chromeBrandList(chromeVersion.split('.')[0] || chromeVersion);
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
