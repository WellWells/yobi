import { statfs } from 'node:fs/promises';
import { screen } from 'electron';
import si from 'systeminformation';
import { formatDiskSize, formatGb, joinParts, once, safe } from './hardwareUtils';
import { createWindowsInventory } from './windowsHardware';
import { resolveActiveInterfaceName, resolvePrimaryMac } from './networkInfo';

const BYTES_PER_GB = 1024 ** 3;

async function readVolumes(): Promise<string> {
  const describe = async (mount: string, label: string): Promise<string | null> => {
    try {
      const s = await statfs(mount);
      const total = (s.blocks * s.bsize) / BYTES_PER_GB;
      const free = (s.bavail * s.bsize) / BYTES_PER_GB;
      return `${label} ${total.toFixed(0)} GB (${free.toFixed(0)} GB free)`;
    } catch {
      return null;
    }
  };
  if (process.platform !== 'win32') {
    return (await describe('/', '/:')) ?? '';
  }
  const volumes = await Promise.all(
    [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => describe(`${letter}:\\`, `${letter}:`)),
  );
  return volumes.filter((v): v is string => v !== null).join('; ');
}

function createSiInventory(): Record<string, () => Promise<string>> {
  const getCpu = once(() => si.cpu());
  const getSystem = once(() => si.system());
  const getBaseboard = once(() => si.baseboard());
  const getBios = once(() => si.bios());
  const getMem = once(() => si.memLayout());
  const getDisks = once(() => si.diskLayout());
  const getGraphics = once(() => si.graphics());

  return {
    manufacturer: () => safe(async () => {
      const system = await getSystem();
      const label = joinParts([system.manufacturer, system.model]);
      if (label) return label;
      const board = await getBaseboard();
      return joinParts([board.manufacturer, board.model]);
    }),
    cpuSpeed: () => safe(async () => {
      const cpu = await getCpu();
      const base = cpu.speed ? `${cpu.speed} GHz` : '';
      const max = cpu.speedMax && cpu.speedMax !== cpu.speed ? ` (max ${cpu.speedMax} GHz)` : '';
      return `${base}${max}`;
    }),
    motherboard: () => safe(async () => {
      const board = await getBaseboard();
      return joinParts([board.manufacturer, board.model, board.version]);
    }),
    bios: () => safe(async () => {
      const bios = await getBios();
      const date = bios.releaseDate ? ` (${bios.releaseDate})` : '';
      return `${joinParts([bios.vendor, bios.version])}${date}`;
    }),
    memoryType: () => safe(async () => {
      const first = (await getMem()).find((m) => m.size > 0);
      if (!first) return '';
      return joinParts([first.type, first.clockSpeed ? `${first.clockSpeed} MHz` : '']);
    }),
    memoryModules: () => safe(async () => (await getMem())
      .filter((m) => m.size > 0)
      .map((m) => joinParts([formatGb(m.size), m.type, m.clockSpeed ? `${m.clockSpeed}MHz` : '', m.manufacturer, m.partNum]))
      .join('; ')),
    graphics: () => safe(async () => (await getGraphics()).controllers
      .filter((c) => c.model)
      .map((c) => joinParts([c.model, c.vram ? `${(c.vram / 1024).toFixed(0)} GB` : ''], ' · '))
      .join('; ')),
    disks: () => safe(async () => (await getDisks())
      .map((d) => {
        const name = joinParts([d.vendor, d.name]) || 'Disk';
        const smart = d.smartStatus && d.smartStatus !== 'unknown' ? `SMART: ${d.smartStatus}` : '';
        const meta = joinParts([d.type, formatDiskSize(d.size), smart], ', ');
        return meta ? `${name} (${meta})` : name;
      })
      .join('; ')),
    networkAdapters: () => safe(async () => {
      const list = await si.networkInterfaces();
      const interfaces = Array.isArray(list) ? list : [list];
      return interfaces
        .filter((i) => !i.internal && !i.virtual)
        .map((i) => i.ifaceName || i.iface)
        .join('; ');
    }),
    dns: () => safe(async () => ''),
  };
}

function createSharedResolvers(): Record<string, () => Promise<string>> {
  return {
    macAddress: () => safe(async () => (await resolvePrimaryMac()) || 'unknown'),
    displays: () => safe(async () => screen.getAllDisplays()
      .map((d) => {
        const width = Math.round(d.size.width * d.scaleFactor);
        const height = Math.round(d.size.height * d.scaleFactor);
        const hz = d.displayFrequency ? ` @${Math.round(d.displayFrequency)}Hz` : '';
        const scale = d.scaleFactor !== 1 ? ` (${Math.round(d.scaleFactor * 100)}%)` : '';
        return `${width}x${height}${hz}${scale}`;
      })
      .join('; ')),
    volumes: () => safe(readVolumes),
    netInterface: () => safe(async () => (await resolveActiveInterfaceName()) || 'unknown'),
    gateway: () => safe(() => si.networkGatewayDefault()),
  };
}

export function createHardwareResolvers(): Record<string, () => Promise<string>> {
  const inventory = process.platform === 'win32' ? createWindowsInventory() : createSiInventory();
  return { ...inventory, ...createSharedResolvers() };
}
