import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import si from 'systeminformation';

const execFileAsync = promisify(execFile);

/**
 * The printers installed on this computer, read without WMI on Windows (the registry the spooler
 * keeps) so a broken WMI cannot hang it — `Get-Printer` and `systeminformation` both go through
 * WMI there. Elsewhere `systeminformation` reads CUPS.
 *
 * The port is kept because it is how a reader tells a real printer from a virtual one: "Microsoft
 * Print to PDF" is on PORTPROMPT:, OneNote on nul:, a USB printer on USB001, a network one on an
 * IP or WSD port.
 */
export interface PrinterEntry {
  name: string;
  port: string;
  isDefault: boolean;
}

const PRINTERS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers';
const CONNECTIONS_KEY = 'HKCU\\Printers\\Connections';
const WINDOWS_DEVICE_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows';

/** `reg query <Printers> /s /v Port`: each printer's key line, then its Port value. */
export function parsePrinterPorts(stdout: string): Array<{ name: string; port: string }> {
  const printers: Array<{ name: string; port: string }> = [];
  const prefix = `${PRINTERS_KEY.replace(/^HKLM/, 'HKEY_LOCAL_MACHINE')}\\`.toUpperCase();
  let current: { name: string; port: string } | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.toUpperCase().startsWith(prefix)) {
      current = { name: line.slice(prefix.length).trim(), port: '' };
      if (current.name && !current.name.includes('\\')) printers.push(current);
      continue;
    }
    const port = /^\s+Port {4}REG_\w+ {4}(.*)$/.exec(line);
    if (port && current) current.port = port[1].trim();
  }
  return printers;
}

/** Shared network printers this user connected to: `,,server,printer` → `\\server\printer`. */
export function parsePrinterConnections(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /\\Connections\\,,([^,]+),(.+)$/i.exec(line.trim());
    if (match) names.push(`\\\\${match[1]}\\${match[2]}`);
  }
  return names;
}

/** The default printer from the `Device` value: `Adobe PDF,winspool,Ne00:` → `Adobe PDF`. */
export function parseDefaultPrinter(stdout: string): string {
  const match = /^\s+Device {4}REG_\w+ {4}(.*)$/m.exec(stdout);
  if (!match) return '';
  const value = match[1].trim();
  const cut = value.indexOf(',');
  return (cut >= 0 ? value.slice(0, cut) : value).trim();
}

/**
 * One line, entries separated by "; " (the JSON output splits on it), so the parenthesis uses a
 * comma: "Adobe PDF (default, port Documents\*.pdf); Microsoft Print to PDF (port PORTPROMPT:)".
 */
export function formatPrinters(printers: readonly PrinterEntry[]): string {
  if (printers.length === 0) return 'none';
  return printers
    .map((printer) => {
      const notes = [printer.isDefault ? 'default' : '', printer.port ? `port ${printer.port}` : ''].filter(Boolean);
      return notes.length > 0 ? `${printer.name} (${notes.join(', ')})` : printer.name;
    })
    .join('; ');
}

async function regQuery(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    // A missing key (no network connections, no default set) exits non-zero; that is "none".
    return '';
  }
}

async function readWindowsPrinters(): Promise<PrinterEntry[]> {
  const [ports, connections, device] = await Promise.all([
    regQuery([PRINTERS_KEY, '/s', '/v', 'Port']),
    regQuery([CONNECTIONS_KEY]),
    regQuery([WINDOWS_DEVICE_KEY, '/v', 'Device']),
  ]);
  const defaultName = parseDefaultPrinter(device);
  const local = parsePrinterPorts(ports);
  const known = new Set(local.map((printer) => printer.name.toLowerCase()));
  const shared = parsePrinterConnections(connections)
    .filter((name) => !known.has(name.toLowerCase()))
    .map((name) => ({ name, port: '' }));
  return [...local, ...shared].map((printer) => ({
    ...printer,
    isDefault: Boolean(defaultName) && printer.name.toLowerCase() === defaultName.toLowerCase(),
  }));
}

async function readSiPrinters(): Promise<PrinterEntry[]> {
  const list = await si.printer();
  return list
    .filter((printer) => printer.name)
    .map((printer) => ({ name: printer.name, port: printer.uri ?? '', isDefault: printer.default === true }));
}

export async function readPrinters(): Promise<string> {
  const printers = process.platform === 'win32' ? await readWindowsPrinters() : await readSiPrinters();
  return formatPrinters(printers);
}
