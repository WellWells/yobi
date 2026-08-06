export type SysInfoCategory = 'system' | 'hardware' | 'network' | 'version';

export interface SysInfoFieldDef {
  readonly key: string;
  readonly category: SysInfoCategory;
}

export const SYSINFO_FIELDS: readonly SysInfoFieldDef[] = [
  { key: 'os', category: 'system' },
  { key: 'platform', category: 'system' },
  { key: 'hostname', category: 'system' },
  { key: 'manufacturer', category: 'system' },
  { key: 'locale', category: 'system' },
  { key: 'timezone', category: 'system' },
  { key: 'uptime', category: 'system' },
  { key: 'time', category: 'system' },
  { key: 'timeLocal', category: 'system' },
  { key: 'cpu', category: 'hardware' },
  { key: 'cpuSpeed', category: 'hardware' },
  { key: 'cpuCores', category: 'hardware' },
  { key: 'memoryTotal', category: 'hardware' },
  { key: 'memoryFree', category: 'hardware' },
  { key: 'memoryType', category: 'hardware' },
  { key: 'memoryModules', category: 'hardware' },
  { key: 'gpu', category: 'hardware' },
  { key: 'graphics', category: 'hardware' },
  { key: 'displays', category: 'hardware' },
  { key: 'motherboard', category: 'hardware' },
  { key: 'bios', category: 'hardware' },
  { key: 'disks', category: 'hardware' },
  { key: 'volumes', category: 'hardware' },
  { key: 'localIp', category: 'network' },
  { key: 'publicIp', category: 'network' },
  { key: 'macAddress', category: 'network' },
  { key: 'gateway', category: 'network' },
  { key: 'netInterface', category: 'network' },
  { key: 'networkAdapters', category: 'network' },
  { key: 'dns', category: 'network' },
  { key: 'appVersion', category: 'version' },
  { key: 'electron', category: 'version' },
  { key: 'node', category: 'version' },
  { key: 'chrome', category: 'version' },
];

export const SYSINFO_CATEGORY_ORDER: readonly SysInfoCategory[] = ['system', 'hardware', 'network', 'version'];

export const SYSINFO_PROBE_FIELDS: ReadonlySet<string> = new Set([
  'manufacturer',
  'cpuSpeed',
  'memoryType',
  'memoryModules',
  'graphics',
  'displays',
  'motherboard',
  'bios',
  'disks',
  'volumes',
  'macAddress',
  'gateway',
  'netInterface',
  'networkAdapters',
  'dns',
]);

/**
 * The runtime versions Yobi is built on. Excluded from the DEFAULT selection, and left out of
 * the field list documented to the flow-generating model, because a sysinfo result is sent
 * verbatim to a third-party provider — and "electron / chrome / node" in one line names the
 * framework the app is written in. They still collect normally when the user ticks them in the
 * field picker: the app may tell the user what it is made of; it does not tell everyone else.
 * `appVersion` stays in the default — Yobi's own version discloses nothing about how it is built.
 */
export const SYSINFO_RUNTIME_FIELDS: ReadonlySet<string> = new Set([
  'electron',
  'node',
  'chrome',
]);

const SYSINFO_FIELD_KEYS = new Set(SYSINFO_FIELDS.map((f) => f.key));

export function parseSysInfoFields(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(',')) {
    const key = part.trim();
    if (SYSINFO_FIELD_KEYS.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  }
  return result;
}

export function resolveSysInfoSelection(
  config: { fields?: string; includeGpu?: string; includePublicIp?: string },
): string[] {
  if (config.fields !== undefined) return parseSysInfoFields(config.fields);
  if (config.includeGpu !== undefined || config.includePublicIp !== undefined) {
    const legacy = SYSINFO_FIELDS
      .map((f) => f.key)
      .filter((key) => key !== 'gpu' && key !== 'publicIp' && key !== 'locale' && !SYSINFO_PROBE_FIELDS.has(key));
    if (config.includeGpu !== 'false') legacy.push('gpu');
    if (config.includePublicIp === 'true') legacy.push('publicIp');
    return legacy;
  }
  return SYSINFO_FIELDS
    .map((f) => f.key)
    .filter((key) => key !== 'publicIp' && !SYSINFO_PROBE_FIELDS.has(key) && !SYSINFO_RUNTIME_FIELDS.has(key));
}
