import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { ExternalEditorChoice, ExternalEditorSettings } from '../shared/types';
import { editorCommandName, isTerminalEditor, launchEnv, type EditorChoice } from './externalEditor';

/*
 * Editors Yobi can find on its own, so picking VS Code is a menu choice rather than an
 * environment variable. Each carries the flag that makes its launcher wait for the file to be
 * closed; without one the session still works (saves sync, "done" ends it), it just cannot end
 * on its own. Install paths are looked up first, then PATH: a GUI app on macOS does not get the
 * shell's PATH, and on Windows the installers put the CLI in a folder the user may not have on it.
 */

export interface EditorPreset {
  id: string;
  label: string;
  args: readonly string[];
  /** Install locations, built from the environment. */
  paths: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string[];
  /** Launcher names to look for on PATH, per platform. */
  pathNames: Partial<Record<NodeJS.Platform, readonly string[]>>;
}

function winDirs(env: NodeJS.ProcessEnv): { local: string; programs: string[] } {
  const programs = [env.ProgramFiles, env['ProgramFiles(x86)']].filter((d): d is string => Boolean(d));
  return { local: env.LOCALAPPDATA ?? '', programs };
}

function macApps(env: NodeJS.ProcessEnv, bundle: string, inner: string): string[] {
  return ['/Applications', env.HOME ? `${env.HOME}/Applications` : '']
    .filter(Boolean)
    .map((dir) => `${dir}/${bundle}/${inner}`);
}

export const EDITOR_PRESETS: readonly EditorPreset[] = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    args: ['--wait'],
    paths: (env, platform) => {
      if (platform === 'darwin') return macApps(env, 'Visual Studio Code.app', 'Contents/Resources/app/bin/code');
      if (platform !== 'win32') return [];
      const { local, programs } = winDirs(env);
      return [
        ...programs.map((dir) => path.win32.join(dir, 'Microsoft VS Code', 'bin', 'code.cmd')),
        local && path.win32.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      ].filter(Boolean);
    },
    pathNames: { win32: ['code.cmd'], linux: ['code'], darwin: ['code'] },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    args: ['--wait'],
    paths: (env, platform) => {
      if (platform === 'darwin') return macApps(env, 'Cursor.app', 'Contents/Resources/app/bin/cursor');
      if (platform !== 'win32') return [];
      const { local } = winDirs(env);
      return local ? [path.win32.join(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd')] : [];
    },
    pathNames: { win32: ['cursor.cmd'], linux: ['cursor'], darwin: ['cursor'] },
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    args: ['--wait'],
    paths: (env, platform) => {
      if (platform === 'darwin') return macApps(env, 'Sublime Text.app', 'Contents/SharedSupport/bin/subl');
      if (platform !== 'win32') return [];
      return winDirs(env).programs.map((dir) => path.win32.join(dir, 'Sublime Text', 'subl.exe'));
    },
    pathNames: { win32: ['subl.exe'], linux: ['subl'], darwin: ['subl'] },
  },
  {
    // A separate instance with no restored session exits when its window closes.
    id: 'notepadpp',
    label: 'Notepad++',
    args: ['-multiInst', '-nosession'],
    paths: (env, platform) => (platform === 'win32'
      ? winDirs(env).programs.map((dir) => path.win32.join(dir, 'Notepad++', 'notepad++.exe'))
      : []),
    pathNames: { win32: ['notepad++.exe'] },
  },
  {
    id: 'zed',
    label: 'Zed',
    args: ['--wait'],
    paths: (env, platform) => (platform === 'darwin' ? macApps(env, 'Zed.app', 'Contents/MacOS/cli') : []),
    pathNames: { win32: ['zed.exe'], linux: ['zed', 'zeditor'], darwin: ['zed'] },
  },
];

export const EDITOR_PRESET_IDS: readonly string[] = EDITOR_PRESETS.map((p) => p.id);

export interface DetectedEditor {
  id: string;
  label: string;
  path: string;
  args: readonly string[];
}

type Exists = (file: string) => boolean;

function searchPath(names: readonly string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: Exists): string | null {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  // The same PATH the launch gets, so what is listed is what can be started.
  const dirs = (launchEnv(env, platform).PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir.replace(/^"|"$/g, ''), name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function findEditor(
  id: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): DetectedEditor | null {
  const preset = EDITOR_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  const found = preset.paths(env, platform).find(exists)
    ?? searchPath(preset.pathNames[platform] ?? [], env, platform, exists);
  return found ? { id: preset.id, label: preset.label, path: found, args: preset.args } : null;
}

export function detectEditors(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): DetectedEditor[] {
  return EDITOR_PRESETS
    .map((preset) => findEditor(preset.id, platform, env, exists))
    .filter((editor): editor is DetectedEditor => editor !== null);
}

export function presetLabel(id: string): string | null {
  return EDITOR_PRESETS.find((p) => p.id === id)?.label ?? null;
}

/**
 * The stored setting as something to launch. A chosen editor that is no longer installed, or a
 * custom choice with no command, falls back to the automatic choice rather than to nothing.
 */
export function editorChoiceFor(
  choice: ExternalEditorChoice,
  command: string,
  find: (id: string) => DetectedEditor | null = findEditor,
): EditorChoice {
  if (choice === 'system') return { kind: 'system' };
  if (choice === 'custom') return command.trim() ? { kind: 'command', command: command.trim() } : { kind: 'auto' };
  const found = choice ? find(choice) : null;
  return found ? { kind: 'program', path: found.path, args: found.args } : { kind: 'auto' };
}

export function editorSettingsSnapshot(
  choice: ExternalEditorChoice,
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): ExternalEditorSettings {
  const editors = detectEditors(platform, env, exists).map(({ id, label }) => ({ id, label }));
  const missing = presetLabel(choice);
  if (missing && !editors.some((e) => e.id === choice)) editors.push({ id: choice, label: missing });
  return { choice, command, editors, autoName: autoEditorName(env, platform) };
}

// What the platform's own editor is called when VISUAL/EDITOR names it.
const SYSTEM_EDITOR_NAMES: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  win32: ['notepad'],
  darwin: ['textedit', 'open'],
  linux: ['xdg-open'],
};

/**
 * What the automatic choice opens, as people call it: null for the system editor (the renderer
 * names it in the app's language), a known editor by its own name, anything else by its program
 * name — never the command line, which is a path as often as not.
 */
export function autoEditorName(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const configured = env.VISUAL?.trim() || env.EDITOR?.trim();
  // The same rule the launch follows: outside Windows a terminal editor gives way to the system one.
  if (!configured || (platform !== 'win32' && isTerminalEditor(configured))) return null;
  const name = editorCommandName(configured);
  if (SYSTEM_EDITOR_NAMES[platform]?.includes(name)) return null;
  const preset = EDITOR_PRESETS.find((p) => Object.values(p.pathNames)
    .some((names) => names?.some((launcher) => launcher.replace(/\.(exe|cmd)$/i, '').toLowerCase() === name)));
  return preset?.label ?? name;
}

/** A stored choice, or '' for anything this version does not know. */
export function normalizeEditorChoice(value: unknown): ExternalEditorChoice {
  if (value === 'system' || value === 'custom') return value;
  if (typeof value === 'string' && EDITOR_PRESET_IDS.includes(value)) return value;
  return '';
}
