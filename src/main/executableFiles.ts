import { extensionOf } from '../shared/attachmentFormats';

/*
 * Yobi never fetches a program to run. One list serves every place a file comes from somebody
 * else: the bot's file intake and the flow's file_download step.
 */

/**
 * Programs, installers, shortcuts, script hosts that run on a double-click, disk images (they
 * mount, and used to skip Mark-of-the-Web) and archives (the usual wrapper for the above).
 */
export const PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'dll', 'msi', 'msp', 'msix', 'msixbundle', 'appx', 'appxbundle', 'com', 'scr', 'pif',
  'cpl', 'sys', 'drv', 'ocx', 'efi', 'vbs', 'vbe', 'jse', 'wsf', 'wsh', 'hta', 'lnk', 'url',
  'reg', 'inf', 'scf', 'chm', 'msc', 'application', 'gadget', 'jar', 'apk', 'xapk', 'ipa', 'app',
  'dmg', 'pkg', 'deb', 'rpm', 'run',
  'iso', 'img', 'vhd', 'vhdx', 'vmdk',
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'arj', 'lzh', 'ace',
]);

/**
 * Plain-text scripts a double-click runs. The bot still reads them as text (saved as .txt); a
 * download keeps the name it is given, so it refuses them.
 */
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'bat', 'cmd', 'ps1', 'psm1', 'js', 'sh', 'command',
]);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'mpg', 'mpeg',
]);

/** The extension Windows would see: trailing dots and spaces dropped, none without a dot. */
export function declaredExtension(fileName: string | undefined): string {
  const base = (fileName ?? '').replace(/[.\s]+$/, '').split(/[\\/]/).pop() ?? '';
  return base.includes('.') ? extensionOf(base) : '';
}

/** A name a download must not be saved under: a program or a runnable script. */
export function isRunnableName(fileName: string): boolean {
  const ext = declaredExtension(fileName);
  return PROGRAM_EXTENSIONS.has(ext) || SCRIPT_EXTENSIONS.has(ext);
}

/** Bytes worth reading before calling a file a program: covers every signature below. */
export const PROGRAM_SNIFF_BYTES = 4_096;

/**
 * Whether the file's first bytes are a program or an archive, whatever it is called: Windows PE,
 * ELF, Mach-O (thin and fat), RAR and 7-Zip. ZIP is not sniffed — .docx, .xlsx and .pptx are ZIPs.
 */
export function looksLikeProgram(head: Uint8Array): boolean {
  const at = (offset: number, ...bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  if (at(0, 0x4d, 0x5a)) return isPortableExecutable(head);
  return at(0, 0x7f, 0x45, 0x4c, 0x46)
    || at(0, 0xfe, 0xed, 0xfa, 0xce) || at(0, 0xfe, 0xed, 0xfa, 0xcf)
    || at(0, 0xce, 0xfa, 0xed, 0xfe) || at(0, 0xcf, 0xfa, 0xed, 0xfe)
    || at(0, 0xca, 0xfe, 0xba, 0xbe)
    || at(0, 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)
    || at(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
}

/**
 * "MZ" alone is two letters. A Windows program carries "PE\0\0" where its header points; when
 * that lies past the sampled bytes, its binary DOS header (text has none) still gives it away.
 */
function isPortableExecutable(head: Uint8Array): boolean {
  if (head.length < 64) return true;
  const offset = (head[60] | (head[61] << 8) | (head[62] << 16)) + head[63] * 0x1_00_00_00;
  if (offset + 4 <= head.length) {
    return head[offset] === 0x50 && head[offset + 1] === 0x45 && head[offset + 2] === 0 && head[offset + 3] === 0;
  }
  return head.subarray(2, 64).some((b) => b < 0x09 || (b > 0x0d && b < 0x20) || b > 0x7e);
}
