import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ipcMain, shell } from 'electron';
import { IPC } from '../../shared/types';
import type { AgentSkillView, SkillImportResult, SkillImportSource, SkillInstallResult, SkillSaveResult } from '../../shared/agentSkills';
import { getMainWindow, sendLog, sendToRenderer } from '../helpers';
import { deleteSkill, installedSkillDir, listSkills, markSkillEdited, setSkillEnabled } from '../agentSkills/skillStore';
import { restoreBundledSkill } from '../agentSkills/bundledSkillVersions';
import { setSkillLocale } from '../agentSkills/bundledSkills';
import { config } from '../config';
import { createSkillFromFiles, readSkillTextFiles, saveSkillTextFiles } from '../agentSkills/skillTextFiles';
import type { SkillFilesView } from '../../shared/skillAuthoring';
import { Mutex } from '../flow/lanes';
import { readEditorFiles } from './skillAuthor';
import { cleanupSkillStaging, discardSkillImport, inspectSkillSource, installImportedSkills } from '../agentSkills/skillImport';
import { exportSkillZip } from '../agentSkills/skillExport';
import { skillsRoot } from '../agentSkills/skillPaths';
import { showOpenDialogForWin, showSaveDialogForWin } from './context';
import { registerSkillAuthorHandlers } from './skillAuthor';
import { checkSkillUpdates, scheduleSkillUpdateChecks } from '../agentSkills/skillUpdates';

/** Saves and creates one at a time: a rename and a write to the same folder must not interleave (Windows refuses with EPERM). */
const saveLane = new Mutex();

/** Files the editor could not have sent (no SKILL.md, a file it does not hold): nothing is written. */
const UNREADABLE_FILES: SkillSaveResult = { ok: false, issue: { code: 'badFile', detail: 'SKILL.md' } };

/** The import menu's "file" item takes a SKILL.md, any .md, a .zip or a .skill; "folder" takes a folder. */
const IMPORT_FILE_EXTENSIONS = ['zip', 'skill', 'md'];

async function announce(): Promise<AgentSkillView[]> {
  const skills = await listSkills();
  sendToRenderer(IPC.SKILLS_CHANGED, skills);
  return skills;
}

/** The interface language changed: a built-in skill for that language appears (or hides) on the open page. */
export function announceSkills(): void {
  void announce().catch(() => {});
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Only the three shapes the renderer may send; a path comes from a picker the user just used. */
function importSource(raw: unknown): SkillImportSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.kind === 'url') return { kind: 'url', url: text(source.url).trim() };
  if (source.kind === 'agents') return { kind: 'agents' };
  if (source.kind === 'path' && text(source.path)) return { kind: 'path', path: text(source.path) };
  return null;
}

export function registerSkillHandlers(): void {
  setSkillLocale(() => config.locale);
  // Previews left by a run that quit mid-import; none can be open yet at startup.
  void cleanupSkillStaging().catch(() => {});
  registerSkillAuthorHandlers();
  scheduleSkillUpdateChecks(() => void announce());

  // The settings page's "check now": one request per source repository.
  ipcMain.handle(IPC.SKILLS_CHECK_UPDATES, async (): Promise<AgentSkillView[]> => {
    await checkSkillUpdates();
    return announce();
  });

  ipcMain.handle(IPC.SKILLS_LIST, (): Promise<AgentSkillView[]> => listSkills());

  ipcMain.handle(IPC.SKILLS_RESTORE_BUNDLED, (_event, raw: unknown): Promise<SkillSaveResult> => saveLane.runExclusive(async () => {
    if (!raw || typeof raw !== 'object') return UNREADABLE_FILES;
    const change = raw as { name?: unknown; revision?: unknown };
    if (typeof change.name !== 'string' || (change.revision !== undefined && typeof change.revision !== 'string')) return UNREADABLE_FILES;
    const result = await restoreBundledSkill({ name: change.name, ...(change.revision ? { revision: change.revision } : {}) });
    if (result.ok) await markSkillEdited(result.name);
    await announce();
    return result;
  }));

  ipcMain.handle(IPC.SKILLS_SET_ENABLED, async (_event, name: unknown, enabled: unknown): Promise<AgentSkillView[]> => {
    if (await setSkillEnabled(text(name), enabled === true)) sendLog(`🧩 [Skills] "${text(name)}" ${enabled === true ? 'enabled' : 'disabled'}`);
    return announce();
  });

  // The picker opens in main so the path never has to be typed or trusted from the page.
  ipcMain.handle(IPC.SKILLS_PICK_IMPORT, async (_event, kind: unknown): Promise<SkillImportResult | null> => {
    const folder = kind === 'folder';
    const picked = await showOpenDialogForWin(getMainWindow(), {
      properties: folder ? ['openDirectory'] : ['openFile'],
      ...(folder ? {} : { filters: [{ name: 'Agent Skill', extensions: IMPORT_FILE_EXTENSIONS }] }),
    });
    const file = picked.canceled ? undefined : picked.filePaths[0];
    return file ? inspectSkillSource({ kind: 'path', path: file }) : null;
  });

  ipcMain.handle(IPC.SKILLS_INSPECT, async (_event, raw: unknown): Promise<SkillImportResult> => {
    const source = importSource(raw);
    // A path is accepted from the picker above only: the page can ask for a URL or the other agents' folders.
    if (!source || source.kind === 'path') return { ok: false, reason: 'notFound' };
    return inspectSkillSource(source);
  });

  ipcMain.handle(IPC.SKILLS_INSTALL, async (_event, id: unknown, keys: unknown): Promise<SkillInstallResult> => {
    const wanted = Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    const result = await installImportedSkills(text(id), wanted);
    await announce();
    // The fresh copy's baseline, taken now: a change pushed before the daily check would otherwise be the baseline.
    if (result.installed.length > 0) void checkSkillUpdates().catch(() => undefined);
    return result;
  });

  ipcMain.handle(IPC.SKILLS_DISCARD, (_event, id: unknown) => discardSkillImport(text(id)));

  // The editor holds a skill's text files (instructions, scripts, references, test cases); the rest is listed.
  ipcMain.handle(IPC.SKILLS_READ, (_event, name: unknown): Promise<SkillFilesView | null> => readSkillTextFiles(text(name)));

  // One skill's saves in order: two quick saves must not rename or write the same folder at once.
  ipcMain.handle(IPC.SKILLS_SAVE, (_event, name: unknown, files: unknown): Promise<SkillSaveResult> => saveLane.runExclusive(async () => {
    const editorFiles = readEditorFiles(files);
    if (!editorFiles) return UNREADABLE_FILES;
    const result = await saveSkillTextFiles(text(name), editorFiles);
    if (result.ok) await announce();
    return result;
  }));

  ipcMain.handle(IPC.SKILLS_CREATE, (_event, files: unknown): Promise<SkillSaveResult> => saveLane.runExclusive(async () => {
    const editorFiles = readEditorFiles(files);
    if (!editorFiles) return UNREADABLE_FILES;
    const result = await createSkillFromFiles(editorFiles);
    if (result.ok) await announce();
    return result;
  }));

  ipcMain.handle(IPC.SKILLS_DELETE, async (_event, name: unknown): Promise<AgentSkillView[]> => {
    if (await deleteSkill(text(name))) sendLog(`🧩 [Skills] deleted "${text(name)}"`);
    return announce();
  });

  ipcMain.handle(IPC.SKILLS_EXPORT, async (_event, name: unknown): Promise<boolean> => {
    const skill = text(name);
    if (!(await installedSkillDir(skill))) return false;
    const picked = await showSaveDialogForWin(getMainWindow(), {
      defaultPath: `${skill}.zip`,
      filters: [{ name: 'Agent Skill', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return false;
    return exportSkillZip(skill, picked.filePath);
  });

  // No name = the skills folder itself, so a user can drop skills in by hand.
  ipcMain.handle(IPC.SKILLS_OPEN_FOLDER, async (_event, name: unknown): Promise<boolean> => {
    const dir = text(name) ? await installedSkillDir(text(name)) : skillsRoot();
    if (!dir) return false;
    await fs.mkdir(dir, { recursive: true });
    return await shell.openPath(path.resolve(dir)) === '';
  });
}
