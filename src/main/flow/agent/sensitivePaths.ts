import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The deny half of the agent's file policy. It outranks every allow, so widening an allow root can
 * never open a credential or system path.
 *
 * Exact for file_read / file_list / file_write, because the path is resolved first. For `shell` it is
 * only a best-effort scan of the command string; the shell boundary is the confirmation dialog plus
 * the output masking in `secretMask.ts`.
 */

const HOME = os.homedir();

/** Normalized for comparison: lower case, forward slashes, no trailing slash. */
function norm(p: string): string {
  return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function underAny(target: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    if (!root) continue;
    const r = norm(root);
    if (target === r || target.startsWith(`${r}/`)) return root;
  }
  return null;
}

/**
 * Operating-system territory. Nothing the agent legitimately does for a user lives here, and
 * everything that does live here is either a secret store or something whose modification is a
 * system-integrity event.
 */
function systemRoots(): string[] {
  if (process.platform === 'win32') {
    const env = process.env;
    return [
      env.SystemRoot ?? 'C:/Windows',
      env.ProgramFiles ?? 'C:/Program Files',
      env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
      env.ProgramData ?? 'C:/ProgramData',
      'C:/Windows',
      'C:/Program Files',
      'C:/Program Files (x86)',
      'C:/ProgramData',
      'C:/Recovery',
      'C:/System Volume Information',
    ];
  }
  return ['/etc', '/var', '/usr', '/bin', '/sbin', '/boot', '/proc', '/sys', '/dev', '/root',
    '/System', '/Library', '/private/etc', '/private/var'];
}

/**
 * Any dot-prefixed path segment (`.ssh`, `.aws`, `.env`, `.npmrc`, ...): by convention that is
 * configuration, which is where credentials live. `.` and `..` are relative-path notation, not dotfiles.
 * Harmless dotfiles such as `.gitignore` are blocked too; an exception list would defeat the rule.
 */
function dotSegment(target: string): string | null {
  for (const segment of target.split('/')) {
    if (segment.length > 1 && segment.startsWith('.') && segment !== '..') return segment;
  }
  return null;
}

/**
 * Credential directories that do NOT start with a dot, so the rule above does not reach them.
 * Blocked whole, because the interesting file inside is not always the one with the obvious name.
 */
function credentialDirs(): string[] {
  const h = HOME;
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? `${h}/AppData/Roaming`;
    const localAppData = process.env.LOCALAPPDATA ?? `${h}/AppData/Local`;
    dirs.push(
      `${appData}/gcloud`, `${appData}/gnupg`, `${appData}/Microsoft/Credentials`,
      `${appData}/Microsoft/Protect`, `${localAppData}/Microsoft/Credentials`,
      `${localAppData}/Google/Chrome/User Data`, `${localAppData}/Microsoft/Edge/User Data`,
      `${appData}/Mozilla/Firefox/Profiles`,
    );
  } else {
    dirs.push(`${h}/Library/Keychains`, `${h}/Library/Application Support/Google/Chrome`);
  }
  return dirs;
}

/**
 * Credential file names, matched case-insensitively on the basename, even inside an allowed folder.
 * A rename defeats this; the directory allow list is the real boundary for the file tools.
 */
const CREDENTIAL_FILE_PATTERNS: readonly RegExp[] = [
  // NOTE: anything dot-prefixed is already refused by `dotSegment`, so this list is only the
  // credentials that do NOT announce themselves with a leading dot.
  /^credentials(\.json)?$/,
  /^_netrc$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^known_hosts$/,
  /^.*\.(pem|key|pfx|p12|jks|keystore|ppk|asc|gpg|kdbx)$/,
  /^secrets?(\.(json|ya?ml|toml|ini|txt))?$/,
  /^service[-_]?account.*\.json$/,
  /^token(s)?(\.json)?$/,
  /^(access|refresh)[-_]?token$/,
  /^local state$/,          // Chromium's DPAPI-wrapped key store
  /^login data$/,           // Chromium saved passwords
  /^cookies(\.sqlite)?$/,
  /^key[34]\.db$/, /^logins\.json$/,   // Firefox
  /^sam$/, /^security$/, /^ntds\.dit$/, // Windows credential hives
  /^unattend(\.xml)?$/, /^sysprep\.inf$/,
];

/** The part of `target` under the longest matching allowed root, or the whole path if none match. */
function belowRoot(target: string, roots: readonly string[]): string {
  let best = '';
  for (const root of roots) {
    if (!root) continue;
    const r = norm(root);
    if ((target === r || target.startsWith(`${r}/`)) && r.length > best.length) best = r;
  }
  return best ? target.slice(best.length) : target;
}

/**
 * Why this exact resolved path is off limits, or null. Used by the file tools, where the path is
 * known before anything is opened, so the answer is exact.
 */
export function sensitivePathReason(resolvedAbs: string, roots: readonly string[] = []): string | null {
  const target = norm(resolvedAbs);

  if (underAny(target, systemRoots())) {
    return 'this is an operating-system location. The agent is not allowed to read or write anywhere under the Windows, Program Files, ProgramData or equivalent system directories';
  }
  if (underAny(target, credentialDirs())) {
    return 'this folder holds credentials (a browser or OS credential store). The agent is never allowed inside it';
  }

  // Scanned BELOW the allowed root, never across it. A user who relocated Documents to
  // `D:/.data/Documents` would otherwise have every single path refused — the rule would read the
  // root's own dot segment and the agent could read nothing at all.
  const dot = dotSegment(belowRoot(target, roots));
  if (dot) {
    return `"${dot}" starts with a dot, so it is configuration rather than content — and configuration is where credentials live. The agent is not allowed to read or write any dot-prefixed file or folder`;
  }

  const base = path.basename(target);
  if (CREDENTIAL_FILE_PATTERNS.some((re) => re.test(base))) {
    return `"${base}" is a credential file by name. The agent is not allowed to read or write it`;
  }
  return null;
}

/*
 * The shell half: a best-effort scan of the command string. Variable expansion or a file name built
 * at run time defeats it, so it only catches the obvious and the accidental; the layer that must hold
 * is `secretMask.ts`, which inspects the output.
 */

/** Literal fragments that only appear in a command reaching for a secret or for system territory. */
const COMMAND_MARKERS: readonly { re: RegExp; reason: string }[] = [
  /*
   * The dot rule in command form. A dot starts a segment only after whitespace, a quote, `=` or a
   * separator, and must be followed by an alphanumeric, so `x.py`, `python3.11`, `./build.sh` and
   * `cd ..` pass.
   */
  { re: /(?:^|[\s"'=/\\])\.[A-Za-z0-9_][^\s"']*/, reason: 'it names a dot-prefixed file or folder, which is configuration and is where credentials live' },
  { re: /\bid_(rsa|dsa|ecdsa|ed25519)\b/i, reason: 'it names an ssh private key' },
  { re: /\bgit-credentials\b/i, reason: 'it names the git credential store' },
  { re: /\b(login data|local state)\b/i, reason: 'it names a browser credential store' },
  { re: /\bnetsh\b.*\bwlan\b.*\bshow\b.*\bprofile\b/i, reason: 'it exports wireless profiles, which can print network keys in clear text' },
  { re: /\bcmdkey\b|\bvaultcmd\b/i, reason: 'it reads the Windows Credential Manager' },
  { re: /\breg\b\s+(save|export)\b.*\bhk(lm|ey_local_machine)\\(sam|security|system)\b/i, reason: 'it exports a credential registry hive' },
  { re: /\bhk(lm|ey_local_machine)\\(sam|security)\b/i, reason: 'it reads a credential registry hive' },
  { re: /\bsystem32[\\/]config\b/i, reason: 'it reaches into the registry hive folder' },
  { re: /\b(lsass|mimikatz|procdump)\b/i, reason: 'it targets the authentication subsystem' },
  { re: /[\\/]etc[\\/](shadow|passwd|sudoers)\b/i, reason: 'it names a system credential file' },
];

/** System roots written literally in a command — the only spelling this scan can see. */
const SYSTEM_LITERALS: readonly { re: RegExp; reason: string }[] = [
  { re: /\b[a-z]:[\\/]windows[\\/]/i, reason: 'it writes to or reads the Windows directory' },
  { re: /\b[a-z]:[\\/]program files( \(x86\))?[\\/]/i, reason: 'it reaches into Program Files' },
  { re: /\bsystem32\b/i, reason: 'it reaches into System32' },
  { re: /\b%systemroot%|\b%windir%/i, reason: 'it reaches into the Windows directory' },
];

/**
 * Why this command is refused before it is ever shown to the user, or null.
 *
 * Refusing BEFORE the dialog is deliberate: a dialog the user is trained to approve is worse than
 * no dialog, and a command that reaches for a credential store should not be presented as a
 * routine choice.
 */
export function sensitiveCommandReason(command: string): string | null {
  const hit = [...COMMAND_MARKERS, ...SYSTEM_LITERALS].find(({ re }) => re.test(command));
  if (!hit) return null;
  return `refused before it ran: ${hit.reason}. Credential stores and system directories are off limits to this agent. Do not retry it or a variation of it — if the user genuinely wants this, they have to do it themselves.`;
}
