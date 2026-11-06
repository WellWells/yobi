/**
 * Which process is LINE for Windows. A process named LINE is LINE only when its program file says so (ProductName
 * "LINE"): line-cli installs itself as line.exe, and Windows process names ignore case, so a bare
 * `Get-Process -Name LINE` can pick that instead and scan the wrong memory. A process whose program
 * cannot be read is kept as a fallback, since LINE's own may be protected.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * PowerShell that sets `$proc` to LINE's process, or $null. Shared by the key and token scans
 * (which run under `$ErrorActionPreference = 'Stop'`) and the running check.
 */
export const FIND_LINE_PROCESS_PS = `
$proc = $null
$unchecked = $null
foreach ($p in @(Get-Process -Name LINE -ErrorAction SilentlyContinue)) {
  $verdict = 'unknown'
  try {
    if ($p.Path) {
      $product = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($p.Path).ProductName
      if ($product -and $product.Trim() -ieq 'LINE') { $verdict = 'line' } else { $verdict = 'other' }
    }
  } catch { $verdict = 'unknown' }
  if ($verdict -eq 'line') { $proc = $p; break }
  if ($verdict -eq 'unknown' -and -not $unchecked) { $unchecked = $p }
}
if (-not $proc) { $proc = $unchecked }
`;

const RUNNING_SCRIPT = `
$ErrorActionPreference = 'Stop'
${FIND_LINE_PROCESS_PS}
if ($proc) { Write-Output 'LINE:RUNNING' } else { Write-Output 'LINE:STOPPED' }
`;

const CHECK_TIMEOUT_MS = 15_000;

async function runCheck(): Promise<string> {
  const encoded = Buffer.from(RUNNING_SCRIPT, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: CHECK_TIMEOUT_MS },
  );
  return stdout;
}

/**
 * Whether LINE is running; null when processes could not be listed.
 * Only lists processes and reads program files' version information, never LINE's memory.
 */
export async function lineRunning(run: () => Promise<string> = runCheck): Promise<boolean | null> {
  try {
    const out = await run();
    if (out.includes('LINE:RUNNING')) return true;
    if (out.includes('LINE:STOPPED')) return false;
    return null;
  } catch {
    return null;
  }
}
