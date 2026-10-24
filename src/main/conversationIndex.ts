import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Dirent } from 'node:fs';
import { conversationIdOf, isConversationId } from '../shared/conversationHistory';
import { conversationPathKey } from './conversationPaths';
import { getOutputDir } from './files';

/*
 * Finds a conversation file by the id in its thread marker when the path someone kept for it
 * (a bot chat's map, an Agent run's file, a send in flight) no longer exists: it was moved into a
 * folder, in Yobi or in Explorer/Finder. Built lazily, only when a path is missing, and thrown away
 * on every change the outputs watcher sees and every move Yobi makes.
 */

/** A path seen to carry an id, kept across rebuilds so a path that is gone still says which file it was. */
const knownIds = new Map<string, string>();
const KNOWN_IDS_CAP = 20_000;

let index: Map<string, string> | null = null;
let building: Promise<Map<string, string>> | null = null;
let generation = 0;

function remember(filePath: string, id: string): void {
  const key = conversationPathKey(filePath);
  knownIds.delete(key);
  knownIds.set(key, id);
  if (knownIds.size <= KNOWN_IDS_CAP) return;
  const oldest = knownIds.keys().next().value;
  if (oldest !== undefined) knownIds.delete(oldest);
}

/** The id this path was last seen with, even after the file left it. */
export function knownConversationId(filePath: string): string | undefined {
  return knownIds.get(conversationPathKey(filePath));
}

export function invalidateConversationIndex(): void {
  index = null;
  building = null;
  generation += 1;
}

/** A file Yobi just moved: its old path keeps pointing at its id, and the index is rebuilt on next use. */
export function noteConversationMoved(from: string, to: string, id: string): void {
  remember(from, id);
  remember(to, id);
  invalidateConversationIndex();
}

/** The id in the file's thread marker, or null (no marker, no id, unreadable). */
export async function conversationIdAt(filePath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  if (!raw.includes('yobi:thread')) return null;
  const id = conversationIdOf(raw);
  if (id) remember(filePath, id);
  return id;
}

/** Reads the file's id in the background, so its path still names it once the file is gone. */
export function learnConversationId(filePath: string): void {
  void conversationIdAt(filePath).catch(() => null);
}

/** Every visible .md under `dir`, folders included; dot-named files and folders are not conversations. */
export async function listConversationFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

async function buildIndex(): Promise<Map<string, string>> {
  const files = await listConversationFiles(await getOutputDir());
  const ids = await Promise.all(files.map(async (file) => [file, await conversationIdAt(file)] as const));
  const next = new Map<string, string>();
  // A copy made outside Yobi carries the same id; the first path in sort order wins, every time.
  for (const [file, id] of ids) if (id && !next.has(id)) next.set(id, file);
  return next;
}

function currentIndex(): Promise<Map<string, string>> {
  if (index) return Promise.resolve(index);
  if (building) return building;
  const started = generation;
  const pending = buildIndex().then((built) => {
    if (generation === started) index = built;
    if (building === pending) building = null;
    return built;
  }, (err: unknown) => {
    if (building === pending) building = null;
    throw err;
  });
  building = pending;
  return pending;
}

async function isFile(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

/**
 * Where the conversation is now: `path` when it is still there (and, given an id, still that
 * conversation), else the file carrying its id anywhere under outputs. Without an id, the id the
 * path was last seen with is used. Null when neither finds a file.
 */
export async function resolveConversationPath(ref: { path: string; id?: string | undefined }): Promise<string | null> {
  const given = ref.path?.trim() ?? '';
  const wanted = isConversationId(ref.id) ? ref.id : undefined;
  if (given && await isFile(given)) {
    if (!wanted) return given;
    const onDisk = await conversationIdAt(given);
    if (!onDisk || onDisk === wanted) return given;
  }
  const id = wanted ?? (given ? knownConversationId(given) : undefined);
  if (!id) return null;

  const cached = index?.get(id);
  if (cached && await conversationIdAt(cached) === id) return cached;
  // Stale or a miss: one fresh crawl decides.
  invalidateConversationIndex();
  const fresh = (await currentIndex().catch(() => null))?.get(id) ?? null;
  return fresh;
}

/** The path and id to keep for a conversation file someone will come back to. */
export async function conversationRefAt(filePath: string): Promise<{ path: string; id?: string }> {
  const id = await conversationIdAt(filePath);
  return id ? { path: filePath, id } : { path: filePath };
}

export function __resetConversationIndex(): void {
  invalidateConversationIndex();
  knownIds.clear();
}
