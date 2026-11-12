import { app } from 'electron';
import * as path from 'node:path';

/** Assets stay outside the archive so the skill sandbox can read its own scripts. */
export function bundledSkillsRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(__dirname, '../../assets/skills');
}
