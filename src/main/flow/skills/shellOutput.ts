import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * What a command printed, as text. Windows console programs (cmd built-ins, ipconfig, PowerShell 5.1
 * writing to a pipe) print in the OEM code page, e.g. Big5 (950). Valid UTF-8 is kept as is; anything
 * else is decoded with the OEM code page.
 */

/** Windows OEM code pages → WHATWG encoding labels `TextDecoder` knows. */
const OEM_ENCODINGS: Record<string, string> = {
  '950': 'big5',
  '936': 'gbk',
  '932': 'shift_jis',
  '949': 'euc-kr',
  '866': 'ibm866',
  '874': 'windows-874',
  '1250': 'windows-1250',
  '1251': 'windows-1251',
  '1252': 'windows-1252',
  '1253': 'windows-1253',
  '1254': 'windows-1254',
  '1255': 'windows-1255',
  '1256': 'windows-1256',
  '1257': 'windows-1257',
  '1258': 'windows-1258',
};

export function oemEncodingLabel(codePage: string): string | null {
  return OEM_ENCODINGS[codePage.trim()] ?? null;
}

/** `reg query …\Nls\CodePage /v OEMCP` → the code page number. */
export function parseOemCodePage(stdout: string): string {
  return /^\s+OEMCP {4}REG_\w+ {4}(\d+)\s*$/m.exec(stdout)?.[1] ?? '';
}

export function decodeShellOutput(bytes: Buffer, fallbackEncoding: string | null): string {
  if (bytes.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: fall through to the console's own code page.
  }
  if (fallbackEncoding) {
    try {
      return new TextDecoder(fallbackEncoding).decode(bytes);
    } catch {
      // An ICU build without this encoding: lossy UTF-8 below is still better than nothing.
    }
  }
  return bytes.toString('utf8');
}

let oemEncoding: Promise<string | null> | undefined;

/** The console code page's decoder label on Windows, read once; null elsewhere or when unknown. */
export function consoleFallbackEncoding(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  oemEncoding ??= execFileAsync(
    'reg.exe',
    ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP'],
    { windowsHide: true },
  )
    .then(({ stdout }) => oemEncodingLabel(parseOemCodePage(stdout)))
    .catch(() => null);
  return oemEncoding;
}
