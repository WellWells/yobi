import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatMbAsGb, joinParts, once, safe } from './hardwareUtils';

const execFileAsync = promisify(execFile);

async function regValues(key: string): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync('reg.exe', ['query', key], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const values: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^ {4}(\S.*?) {4}REG_\w+ {4}(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

async function regSubkeys(key: string): Promise<string[]> {
  const { stdout } = await execFileAsync('reg.exe', ['query', key], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.toUpperCase().startsWith('HKEY_'));
}

async function regBinary(key: string, name: string): Promise<Buffer | null> {
  const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const match = stdout.match(/REG_BINARY {4}([0-9A-Fa-f]+)/);
  return match ? Buffer.from(match[1], 'hex') : null;
}

const SMBIOS_MEMORY_TYPES: Record<number, string> = {
  0x12: 'DDR', 0x13: 'DDR2', 0x14: 'DDR2 FB-DIMM', 0x18: 'DDR3',
  0x1a: 'DDR4', 0x1b: 'LPDDR', 0x1c: 'LPDDR2', 0x1d: 'LPDDR3',
  0x1e: 'LPDDR4', 0x22: 'DDR5', 0x23: 'LPDDR5',
};

interface MemoryModule {
  sizeMb: number;
  type: string;
  speed: number;
  manufacturer: string;
  partNumber: string;
}

function parseSmbiosMemory(raw: Buffer): MemoryModule[] {
  const tableLen = raw.readUInt32LE(4);
  const table = raw.subarray(8, Math.min(raw.length, 8 + tableLen));
  const modules: MemoryModule[] = [];
  let offset = 0;
  for (let guard = 0; guard < 2048 && offset + 4 <= table.length; guard += 1) {
    const type = table[offset];
    const structLen = table[offset + 1];
    if (structLen < 4) break;

    let cursor = offset + structLen;
    const strings: string[] = [];
    if (table[cursor] === 0 && table[cursor + 1] === 0) {
      cursor += 2;
    } else {
      let start = cursor;
      while (cursor < table.length) {
        if (table[cursor] === 0) {
          strings.push(table.subarray(start, cursor).toString('latin1'));
          if (table[cursor + 1] === 0) { cursor += 2; break; }
          start = cursor + 1;
        }
        cursor += 1;
      }
    }
    const str = (n: number): string => (n >= 1 && n <= strings.length ? strings[n - 1].trim() : '');

    if (type === 17 && offset + 0x1b <= offset + structLen) {
      const sizeRaw = table.readUInt16LE(offset + 0x0c);
      if (sizeRaw !== 0 && sizeRaw !== 0xffff) {
        const sizeMb = sizeRaw === 0x7fff && structLen >= 0x20
          ? table.readUInt32LE(offset + 0x1c)
          : (sizeRaw & 0x8000 ? (sizeRaw & 0x7fff) / 1024 : sizeRaw);
        modules.push({
          sizeMb,
          type: SMBIOS_MEMORY_TYPES[table[offset + 0x12]] ?? '',
          speed: table.readUInt16LE(offset + 0x15),
          manufacturer: str(table[offset + 0x17]),
          partNumber: str(table[offset + 0x1a]),
        });
      }
    }
    if (type === 127) break;
    offset = cursor;
  }
  return modules;
}

const BIOS_KEY = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS';
const CPU_KEY = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0';
const GPU_CLASS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
const NET_CLASS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e972-e325-11ce-bfc1-08002be10318}';
const MSSMBIOS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\mssmbios\\Data';
const DISK_ENUM_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\disk\\Enum';
const TCPIP_INTERFACES_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces';

const VIRTUAL_NIC = /miniport|wan|kernel debug|wi-fi direct|virtual|tunnel|wintun|zerotier|vpn|loopback|hyper-v|teredo|6to4|bluetooth|microsoft|apple mobile/i;

const SYSTEM_NAME_PLACEHOLDERS = new Set([
  'System Product Name', 'To be filled by O.E.M.', 'To Be Filled By O.E.M.',
  'Default string', 'Type1ProductConfigId', 'OEM', 'None', '',
]);

async function readGraphics(): Promise<string> {
  const cards: string[] = [];
  for (const subkey of await regSubkeys(GPU_CLASS_KEY)) {
    if (!/\\\d{4}$/.test(subkey)) continue;
    const values = await regValues(subkey);
    const desc = (values.DriverDesc ?? '').trim();
    if (!desc || /Microsoft (Basic|Remote) Display/i.test(desc)) continue;
    const vram = Number(values['HardwareInformation.qwMemorySize']);
    cards.push(joinParts([desc, vram > 0 ? `${Math.round(vram / 1024 ** 3)} GB` : ''], ' · '));
  }
  return cards.join('; ');
}

async function readDisks(): Promise<string> {
  const enumValues = await regValues(DISK_ENUM_KEY);
  const disks: string[] = [];
  for (const [index, instance] of Object.entries(enumValues)) {
    if (!/^\d+$/.test(index) || !instance) continue;
    const friendly = (await regValues(`HKLM\\SYSTEM\\CurrentControlSet\\Enum\\${instance}`)).FriendlyName;
    if (friendly && !/virtual disk|@disk\.inf/i.test(friendly)) disks.push(friendly.trim());
  }
  return disks.join('; ');
}

async function readNetworkAdapters(): Promise<string> {
  const { stdout } = await execFileAsync('reg.exe', ['query', NET_CLASS_KEY, '/s', '/v', 'DriverDesc'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const models: string[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+DriverDesc {4}REG_\w+ {4}(.*)$/);
    if (!match) continue;
    const desc = match[1].trim();
    if (!desc || VIRTUAL_NIC.test(desc) || seen.has(desc)) continue;
    seen.add(desc);
    models.push(desc);
  }
  return models.join('; ');
}

async function readDns(): Promise<string> {
  const { stdout } = await execFileAsync('reg.exe', ['query', TCPIP_INTERFACES_KEY, '/s'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const servers: string[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+(?:Dhcp)?NameServer {4}REG_\w+ {4}(.*)$/);
    if (!match) continue;
    for (const ip of match[1].split(/[ ,]+/)) {
      const addr = ip.trim();
      if (addr && !seen.has(addr)) {
        seen.add(addr);
        servers.push(addr);
      }
    }
  }
  return servers.join('; ');
}

export function createWindowsInventory(): Record<string, () => Promise<string>> {
  const biosKey = once(() => regValues(BIOS_KEY));
  const cpuKey = once(() => regValues(CPU_KEY));
  const memory = once(async () => {
    const raw = await regBinary(MSSMBIOS_KEY, 'SMBiosData');
    return raw ? parseSmbiosMemory(raw) : [];
  });

  return {
    manufacturer: () => safe(async () => {
      const k = await biosKey();
      const product = (k.SystemProductName ?? '').trim();
      if (product && !SYSTEM_NAME_PLACEHOLDERS.has(product)) return joinParts([k.SystemManufacturer, product]);
      return joinParts([k.SystemManufacturer, k.BaseBoardProduct]);
    }),
    cpuSpeed: () => safe(async () => {
      const mhz = Number((await cpuKey())['~MHz']);
      return mhz > 0 ? `${(mhz / 1000).toFixed(1)} GHz` : '';
    }),
    motherboard: () => safe(async () => {
      const k = await biosKey();
      return joinParts([k.BaseBoardManufacturer, k.BaseBoardProduct]);
    }),
    bios: () => safe(async () => {
      const k = await biosKey();
      const date = k.BIOSReleaseDate ? ` (${k.BIOSReleaseDate})` : '';
      return `${joinParts([k.BIOSVendor, k.BIOSVersion])}${date}`;
    }),
    memoryType: () => safe(async () => {
      const first = (await memory())[0];
      if (!first) return '';
      return joinParts([first.type, first.speed ? `${first.speed} MHz` : '']);
    }),
    memoryModules: () => safe(async () => (await memory())
      .map((m) => joinParts([formatMbAsGb(m.sizeMb), m.type, m.speed ? `${m.speed}MHz` : '', m.manufacturer, m.partNumber]))
      .join('; ')),
    graphics: () => safe(readGraphics),
    disks: () => safe(readDisks),
    networkAdapters: () => safe(readNetworkAdapters),
    dns: () => safe(readDns),
  };
}
