import { createSocket } from 'node:dgram';
import * as os from 'node:os';

function isSyntheticIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

interface Ipv4Interface {
  address: string;
  mac: string;
}

function collectLocalInterfaces(): Ipv4Interface[] {
  const result: Ipv4Interface[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && !isSyntheticIp(addr.address)) {
        result.push({ address: addr.address, mac: addr.mac });
      }
    }
  }
  return result;
}

const PRIMARY_IP_TIMEOUT_MS = 500;

export function resolvePrimaryLocalIp(): Promise<string> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    function finish(ip: string): void {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
      }
      resolve(ip);
    }
    const timer = setTimeout(() => finish(''), PRIMARY_IP_TIMEOUT_MS);
    socket.once('error', () => finish(''));
    try {
      socket.connect(53, '8.8.8.8', () => {
        const ip = socket.address().address;
        finish(ip && ip !== '0.0.0.0' ? ip : '');
      });
    } catch {
      finish('');
    }
  });
}

export async function resolveLocalIp(): Promise<string> {
  const primary = await resolvePrimaryLocalIp();
  if (primary) return primary;
  return collectLocalInterfaces()[0]?.address ?? '';
}

export async function resolveActiveInterfaceName(): Promise<string> {
  const primaryIp = await resolvePrimaryLocalIp();
  if (!primaryIp) return '';
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && addr.address === primaryIp) return name;
    }
  }
  return '';
}

const ZERO_MAC = '00:00:00:00:00:00';

export async function resolvePrimaryMac(): Promise<string> {
  const interfaces = collectLocalInterfaces().filter((i) => i.mac && i.mac !== ZERO_MAC);
  if (interfaces.length === 0) return '';
  const primaryIp = await resolvePrimaryLocalIp();
  const match = interfaces.find((i) => i.address === primaryIp);
  return (match ?? interfaces[0]).mac;
}
