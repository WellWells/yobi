import { app } from 'electron';
import * as path from 'node:path';

/** Kept apart so tests can point both folders at a temp directory with one mock. */

/** Installed skills, one folder each, named after the skill. */
export function skillsRoot(): string {
  return path.join(app.getPath('userData'), 'skills');
}

/** Sources unpacked for an import preview; anything left here at start-up is from a run that ended mid-import. */
export function skillStagingRoot(): string {
  return path.join(app.getPath('userData'), 'skills-staging');
}

/** Which skills are switched off and where each came from. Dot-named, so it can never be a skill. */
export const SKILL_STATE_FILE = '.state.json';
