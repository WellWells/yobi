import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The DENY half of the agent's file policy, and it outranks every allow.
 *
 * The allow side (`getAgentFileRoots` / `getAgentWriteRoots`) answers "where may the agent work".
 * This answers "what may it never touch, wherever it is" — which is a different question, because
 * a credential can sit inside an allowed folder (`Desktop/id_rsa`) and a system folder can be
 * added to the allow list later by a user who did not think about `System32`.
 *
 * Deny-wins is the same precedence Claude Code uses for its permission rules, and it is the only
 * ordering that is safe to reason about: widening an allow can never quietly open a deny.
 *
 * SCOPE, stated honestly. For `file_read` / `file_list` / `file_write` this is EXACT — the path
 * is resolved before it is checked, so it cannot be dodged. For `shell` it is a best-effort scan
 * of the command STRING (see `sensitiveCommandReason`), which a rename, an environment variable
 * or a generated script defeats. That scan is defence in depth, not a boundary; the boundary for
 * shell is the confirmation dialog plus the output masking in `secretMask.ts`.
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
 * ANY dot-prefixed path segment. This is a rule where the rest of this file is a list, and it
 * carries most of the weight: `.ssh`, `.aws`, `.gnupg`, `.claude`, `.docker`, `.kube`, `.env`,
 * `.npmrc`, `.netrc`, `.git-credentials` and every `.foobarrc` a tool invents next year all fall
 * out of one line. An enumeration is only ever as current as the day it was written.
 *
 * The premise is the convention itself: a leading dot means "configuration, not content", and
 * configuration is where credentials live. Nothing the agent is asked to help with — a document,
 * a spreadsheet, a download — is dot-prefixed.
 *
 * `.` and `..` are NOT dotfiles; they are relative-path notation, and treating them as a hit
 * would refuse `./build.sh` and `cd ..`.
 *
 * KNOWN COST, accepted deliberately: `.gitignore`, `.editorconfig` and `.prettierrc` become
 * unreadable too. They are harmless, but separating them needs an exception list, and an
 * exception list is the enumeration this rule exists to avoid.
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
 * File names that are a credential wherever they sit, including inside a folder the agent is
 * otherwise allowed to use. Matched on the BASENAME, case-insensitively.
 *
 * A rename defeats this and that is fine: for the file tools the directory allow list is the real
 * boundary, and this list only has to cover the credential that a user genuinely does keep on
 * their Desktop.
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

export interface SensitiveHit {
  /** A short, model-facing reason. Never contains the resolved absolute path. */
  reason: string;
}

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
 * ---------------------------------------------------------------------------------------------
 * The shell half. READ THE LIMITS BEFORE TRUSTING THIS.
 *
 * A shell command has no inspectable path: `%USERPROFILE%\.claude` contains no path until cmd.exe
 * expands it, and `set A=.cre& set B=dentials& type %A%%B%.json` builds the name at run time.
 * Both were measured. So this scan stops the obvious and the accidental — a model that simply
 * asks for the file by name, which is exactly what happened — and stops nothing that is trying.
 *
 * It is here because the alternative to a leaky first layer is no first layer, not a perfect one.
 * The layer that actually has to hold is `secretMask.ts`, which inspects the OUTPUT and therefore
 * does not care how the path was spelled.
 * ---------------------------------------------------------------------------------------------
 */

/** Literal fragments that only appear in a command reaching for a secret or for system territory. */
const COMMAND_MARKERS: readonly { re: RegExp; reason: string }[] = [
  /*
   * The dot rule, in command form: a path segment that begins with a dot. One line instead of the
   * nine per-folder markers it replaced (.ssh, .aws, .gnupg, .claude, .config/gcloud, .npmrc,
   * .pypirc, .netrc, .credentials.json).
   *
   * The lead-in class is what keeps it quiet. A dot only starts a SEGMENT after whitespace, a
   * quote, `=` or a separator — so `x.py`, `python3.11`, `README.md`, `./build.sh` (the char after
   * the dot must be alphanumeric) and `cd ..` all pass through untouched.
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
