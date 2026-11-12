import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { sendLog } from '../helpers';
import { installedSkillDir } from './skillStore';
import { scanSkillFiles } from './skillFiles';

/**
 * Writes one skill as a zip whose single top folder is the skill's name (`pdf/SKILL.md`, …): the
 * layout claude.ai's upload, Gemini CLI's `.skill` files and a plain unzip into `~/.agents/skills`
 * all accept. The same files a scan lists — no `.git`, caches or links.
 */
export async function exportSkillZip(name: string, targetFile: string): Promise<boolean> {
  const dir = await installedSkillDir(name);
  if (!dir) return false;
  const scan = await scanSkillFiles(dir);
  const zip = new AdmZip();
  for (const file of scan.files) {
    const zipPath = `${name}/${file.rel}`;
    const slash = zipPath.lastIndexOf('/');
    zip.addLocalFile(file.abs, zipPath.slice(0, slash), zipPath.slice(slash + 1));
  }
  await zip.writeZipPromise(targetFile);
  sendLog(`🧩 [Skills] exported "${name}" (${scan.files.length} files) to ${path.basename(targetFile)}`);
  return true;
}
