/**
 * Extracts the LINE PC wxSQLite3 passphrase from LINE.exe process memory (Windows only).
 *
 * LINE itself keeps the key only in its running process's memory — never on disk — so a
 * normal signed consumer app cannot obtain it on macOS (SIP / hardened runtime block reading
 * another process's memory). On Windows the scan runs in PowerShell via kernel32
 * ReadProcessMemory; this module ranks the candidates and probes them.
 *
 * SECURITY: nothing here logs the key or puts it in an error message. It is handed back to
 * LineService, which stores it through lineKeyStore (safeStorage-encrypted, in a file the
 * backup archive does not collect) so this ~80s scan is paid once per install rather than
 * once per launch.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LineError } from './errors';

const execFileAsync = promisify(execFile);

// Cap region size aggressively: the key is a small heap string, so scanning multi-GB
// regions only wastes time. 128MB keeps coverage while holding the scan under a minute.
const MAX_REGION_BYTES = 128 * 1024 * 1024;
const SCAN_TIMEOUT_MS = 150_000;
const SCAN_MAX_BUFFER = 64 * 1024 * 1024;
// Emit all candidates (frequency-ordered), not a top-N slice: the reference probes the
// full set serially and the key is not guaranteed to be high-frequency on every build.
const MAX_CANDIDATES = 100_000;

export function validateKeyFormat(candidate: string): boolean {
  if (candidate.length !== 32 && candidate.length !== 64) return false;
  return /^[0-9a-f]+$/.test(candidate);
}

/**
 * Parses the PowerShell scanner output: "<count> <hex>" lines, most-frequent first.
 * Malformed lines, blanks, and "ERR:*" markers are dropped; hex is lowercased and
 * format-validated; the result is deduped, ordered by descending frequency.
 */
export function parseKeyCandidates(stdout: string): string[] {
  const ranked: { hex: string; count: number }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('ERR:')) continue;
    const match = trimmed.match(/^(\d+)\s+([0-9a-fA-F]+)$/);
    if (!match) continue;
    const hex = match[2].toLowerCase();
    if (!validateKeyFormat(hex)) continue;
    ranked.push({ hex, count: Number(match[1]) });
  }
  ranked.sort((a, b) => b.count - a.count);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { hex } of ranked) {
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
}

// PowerShell scanner: find LINE.exe, walk its committed private regions via
// VirtualQueryEx, ReadProcessMemory each, extract 32-char hex tokens from both ASCII
// and UTF-16LE (Qt QString) encodings, aggregate by frequency, emit "<count> <hex>".
const SCAN_SCRIPT = `
$ErrorActionPreference = 'Stop'
$proc = Get-Process -Name LINE -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output 'ERR:LINE_NOT_RUNNING'; exit 0 }
$src = @'
using System;
using System.Runtime.InteropServices;
public class YobiMem {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, uint len);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
    public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }
}
'@
Add-Type -TypeDefinition $src
$h = [YobiMem]::OpenProcess(0x10 -bor 0x400, $false, $proc.Id)
if ($h -eq [IntPtr]::Zero) { Write-Output 'ERR:MEMORY_READ_FAILED'; exit 0 }
$max = ${MAX_REGION_BYTES}
$addr = [IntPtr]::Zero
$counts = @{}
$mbi = New-Object YobiMem+MEMORY_BASIC_INFORMATION
$sz = [System.Runtime.InteropServices.Marshal]::SizeOf($mbi)
$rx = [regex]'(?<![0-9A-Za-z])([0-9a-fA-F]{32})(?![0-9A-Za-z])'
while ([YobiMem]::VirtualQueryEx($h, $addr, [ref]$mbi, $sz) -ne 0) {
  $region = [int64]$mbi.RegionSize
  $commit = ($mbi.State -eq 0x1000)
  $priv = ($mbi.Type -eq 0x20000)
  $noaccess = (($mbi.Protect -band 0x1) -ne 0)
  $guard = (($mbi.Protect -band 0x100) -ne 0)
  if ($commit -and $priv -and (-not $noaccess) -and (-not $guard) -and $region -gt 0 -and $region -le $max) {
    $buf = New-Object byte[] $region
    $read = 0
    if ([YobiMem]::ReadProcessMemory($h, $mbi.BaseAddress, $buf, $region, [ref]$read) -and $read -gt 0) {
      $ascii = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
      foreach ($m in $rx.Matches($ascii)) { $k = $m.Groups[1].Value.ToLower(); $counts[$k] = 1 + $counts[$k] }
      $utf16 = [System.Text.Encoding]::Unicode.GetString($buf, 0, $read)
      foreach ($m in $rx.Matches($utf16)) { $k = $m.Groups[1].Value.ToLower(); $counts[$k] = 1 + $counts[$k] }
    }
  }
  $next = [int64]$mbi.BaseAddress + $region
  if ($next -le ([int64]$mbi.BaseAddress)) { break }
  if ($next -ge 0x7FFFFFFF0000) { break }
  $addr = [IntPtr]$next
}
[YobiMem]::CloseHandle($h) | Out-Null
$counts.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First ${MAX_CANDIDATES} | ForEach-Object { [string]$_.Value + ' ' + $_.Name }
`;

async function runScan(): Promise<string> {
  const encoded = Buffer.from(SCAN_SCRIPT, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_BUFFER },
  );
  return stdout;
}

export interface ExtractKeyDeps {
  platform?: NodeJS.Platform;
  scan?: () => Promise<string>;
}

/**
 * Scan LINE's memory and return the first candidate that decrypts `dbPath`.
 * `probe` is injected by the reader so this module never loads the native SQLite
 * driver (keeping it importable in the offline test environment).
 */
export async function extractLineKey(
  dbPath: string,
  probe: (dbPath: string, key: string) => boolean,
  deps?: ExtractKeyDeps,
): Promise<string> {
  const platform = deps?.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new LineError('UNSUPPORTED_PLATFORM', 'Key extraction is only available on Windows.');
  }
  const stdout = deps?.scan ? await deps.scan() : await runScan();
  if (stdout.includes('ERR:LINE_NOT_RUNNING')) {
    throw new LineError('LINE_NOT_RUNNING', 'LINE is not running. Start LINE, sign in, and try again.');
  }
  if (stdout.includes('ERR:MEMORY_READ_FAILED')) {
    throw new LineError('MEMORY_READ_FAILED', 'Could not open LINE process memory. Try running as Administrator.');
  }
  const candidates = parseKeyCandidates(stdout);
  if (candidates.length === 0) {
    throw new LineError('KEY_SCAN_EMPTY', 'No key candidates were found in LINE process memory.');
  }
  for (const key of candidates) {
    if (probe(dbPath, key)) return key;
  }
  throw new LineError(
    'NO_KEY_DECRYPTED',
    'Found key candidates but none decrypted the database. LINE may have rotated its key or changed its cipher.',
  );
}
