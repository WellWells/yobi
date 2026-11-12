import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from '../atomicWrite';
import { folderKey, folderNameProblem, normalizeFolderName } from '../../shared/conversationFolders';
import { FLOW_FOLDERS_FILE, parseFlowFolders, placeFlows } from '../../shared/flowFolders';
import type {
  FlowFolder,
  FlowFolderDeleteResult,
  FlowFolderMoveResult,
  FlowFolderResult,
} from '../../shared/flowFolders';
import type { FlowDefinition } from '../../shared/types';

/*
 * The flow sidebar's folders, kept in `flow-folders.json` in the flow data dir. One change at a
 * time: every operation waits for the one before it. Ids of deleted flows stay in the file and are
 * left out of what is listed, so a flow brought back by a restore returns to its folder. The flows
 * themselves are never written here; a move that needs a new order asks `reorder` for it.
 */

export interface FlowFolderStoreDeps {
  dir: () => string;
  /** Every flow id, in `flows.json` order. */
  flowOrder: () => string[];
  /** Saves the flows in this order (FlowManager.reorder): their content is left as it is. */
  reorder: (orderedIds: string[]) => Promise<FlowDefinition[]>;
  broadcast: (folders: FlowFolder[]) => void;
  log?: (line: string) => void;
}

const FILE_VERSION = 1;

function cloneFolders(folders: readonly FlowFolder[]): FlowFolder[] {
  return folders.map((folder) => ({ name: folder.name, flowIds: [...folder.flowIds] }));
}

export class FlowFolderStore {
  /** Null until read. */
  private folders: FlowFolder[] | null = null;
  /** The file is there but does not parse: kept as `.bak` before the next write. */
  private damaged = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FlowFolderStoreDeps) {}

  private file(): string {
    return path.join(this.deps.dir(), FLOW_FOLDERS_FILE);
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<FlowFolder[]> {
    if (this.folders) return this.folders;
    let raw: string;
    try {
      raw = await fs.readFile(this.file(), 'utf-8');
    } catch (err: unknown) {
      // Missing is simply no folders; a file that cannot be read is kept like a damaged one.
      this.damaged = (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
      this.folders = [];
      return this.folders;
    }
    let parsed: FlowFolder[] | null = null;
    try {
      parsed = parseFlowFolders(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    this.damaged = parsed === null;
    if (this.damaged) this.deps.log?.(`⚠️ [Flow] ${FLOW_FOLDERS_FILE} could not be read; the flow folders start empty`);
    this.folders = parsed ?? [];
    return this.folders;
  }

  /** The folders as the window sees them: only flows that exist. */
  private view(folders: readonly FlowFolder[]): FlowFolder[] {
    const known = new Set(this.deps.flowOrder());
    return folders.map((folder) => ({ name: folder.name, flowIds: folder.flowIds.filter((id) => known.has(id)) }));
  }

  private async save(folders: FlowFolder[]): Promise<void> {
    const file = this.file();
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (this.damaged) {
      try {
        await fs.rename(file, `${file}.bak`);
        this.deps.log?.(`⚠️ [Flow] Kept the unreadable ${FLOW_FOLDERS_FILE} as ${FLOW_FOLDERS_FILE}.bak`);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
      this.damaged = false;
    }
    await writeFileAtomic(file, JSON.stringify({ version: FILE_VERSION, folders }, null, 2));
    this.folders = folders;
    this.deps.broadcast(this.view(folders));
  }

  private find(folders: readonly FlowFolder[], name: string): number {
    const key = folderKey(normalizeFolderName(name));
    return folders.findIndex((folder) => folderKey(folder.name) === key);
  }

  list(): Promise<FlowFolder[]> {
    return this.run(async () => this.view(await this.load()));
  }

  /**
   * Makes a folder. With `restoreIds` (undoing a delete) the flows among them still at the top
   * level go back into it, and a folder of that name made meanwhile is used instead.
   */
  create(name: string, restoreIds?: readonly string[]): Promise<FlowFolderResult> {
    return this.run(async () => {
      const folders = cloneFolders(await this.load());
      const known = new Set(this.deps.flowOrder());
      const filed = new Set(folders.flatMap((folder) => folder.flowIds));
      const returning = (restoreIds ?? []).filter((id) => known.has(id) && !filed.has(id));
      const existing = restoreIds ? this.find(folders, name) : -1;
      if (existing >= 0) {
        const folder = folders[existing]!;
        if (returning.length > 0) {
          folder.flowIds.push(...returning);
          await this.save(folders);
        }
        return { ok: true, name: folder.name };
      }
      const problem = folderNameProblem(name, folders.map((folder) => folder.name), undefined, 'label');
      if (problem) return { ok: false, error: problem };
      const created = normalizeFolderName(name);
      await this.save([...folders, { name: created, flowIds: returning }]);
      return { ok: true, name: created };
    });
  }

  rename(from: string, to: string): Promise<FlowFolderResult> {
    return this.run(async () => {
      const folders = cloneFolders(await this.load());
      const index = this.find(folders, from);
      if (index < 0) return { ok: false, error: 'missing' };
      const folder = folders[index]!;
      const problem = folderNameProblem(to, folders.map((each) => each.name), folder.name, 'label');
      if (problem) return { ok: false, error: problem };
      const renamed = normalizeFolderName(to);
      if (renamed !== folder.name) {
        folder.name = renamed;
        await this.save(folders);
      }
      return { ok: true, name: renamed };
    });
  }

  /** Removes the folder; its flows stay where they are in the order, now at the top level. */
  remove(name: string): Promise<FlowFolderDeleteResult> {
    return this.run(async () => {
      const folders = cloneFolders(await this.load());
      const index = this.find(folders, name);
      if (index < 0) return { ok: false, flowIds: [], error: 'missing' };
      const known = new Set(this.deps.flowOrder());
      const flowIds = folders[index]!.flowIds.filter((id) => known.has(id));
      folders.splice(index, 1);
      await this.save(folders);
      return { ok: true, flowIds };
    });
  }

  /**
   * Files flows into `folder` (`''` = the top level): after the flows already there, or right
   * before `before` (a drag dropped on that row). The order changes only when it has to.
   */
  move(flowIds: readonly string[], folder: string, before?: string): Promise<FlowFolderMoveResult> {
    return this.run(async () => {
      const folders = cloneFolders(await this.load());
      const targetIndex = folder === '' ? -1 : this.find(folders, folder);
      if (folder !== '' && targetIndex < 0) return { ok: false, error: 'missing' };
      const order = this.deps.flowOrder();
      const known = new Set(order);
      const target = targetIndex >= 0 ? folders[targetIndex]!.name : '';
      const homeOf = (id: string): string => folders.find((each) => each.flowIds.includes(id))?.name ?? '';
      // Filed at the end, a flow already in the folder stays put (a mixed selection was offered
      // the folder some of it is in); dropped before a row, it goes there.
      const moving = [...new Set(flowIds)].filter((id) => known.has(id) && (before !== undefined || homeOf(id) !== target));
      if (moving.length === 0) return { ok: true };
      const movingSet = new Set(moving);
      const before0 = JSON.stringify(folders);
      for (const each of folders) each.flowIds = each.flowIds.filter((id) => !movingSet.has(id));
      if (targetIndex >= 0) folders[targetIndex]!.flowIds.push(...moving);
      if (JSON.stringify(folders) !== before0) await this.save(folders);
      const home = new Map<string, string>();
      for (const each of folders) for (const id of each.flowIds) home.set(id, each.name);
      const placed = placeFlows(order, (id) => home.get(id) ?? '', moving, target, before);
      if (placed.every((id, index) => id === order[index])) return { ok: true };
      return { ok: true, flows: await this.deps.reorder(placed) };
    });
  }

  /** A copy of a flow goes into the folder its original is in. */
  adoptDuplicate(sourceId: string, copyId: string): Promise<void> {
    return this.run(async () => {
      const folders = cloneFolders(await this.load());
      const folder = folders.find((each) => each.flowIds.includes(sourceId));
      if (!folder || folders.some((each) => each.flowIds.includes(copyId))) return;
      folder.flowIds.push(copyId);
      await this.save(folders);
    });
  }

  /** Reads the file again (a backup was restored) and tells the window. */
  reload(): Promise<void> {
    return this.run(async () => {
      this.folders = null;
      this.deps.broadcast(this.view(await this.load()));
    });
  }
}

let instance: FlowFolderStore | null = null;

/** Made once main's IPC is registered, when the flow manager exists. */
export function configureFlowFolders(deps: FlowFolderStoreDeps): FlowFolderStore {
  instance = new FlowFolderStore(deps);
  return instance;
}

export function getFlowFolderStore(): FlowFolderStore | null {
  return instance;
}
