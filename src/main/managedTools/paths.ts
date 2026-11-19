import * as path from 'node:path';

/** `child` is `root` itself or somewhere below it, after resolving `..` segments. */
export function isInsideDir(root: string, child: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  if (rel === '') return true;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** `ffmpeg` → `ffmpeg.exe` on Windows. */
export function executableName(base: string, platform: string = process.platform): string {
  return platform === 'win32' ? `${base}.exe` : base;
}

/** Compares dotted numeric versions (`2026.08.19`, `1.0.161`, `v1.0.9`): negative, 0 or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
