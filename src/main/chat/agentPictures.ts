import * as path from 'node:path';
import type { AgentRunState } from '../../shared/types';
import { chatMediaDir } from '../chatMedia';
import type { DrawImage } from '../flow/agent/agentDrawImage';
import { saveRunState } from '../flow/agent/agentRunStore';
import { agentReadPathFor } from '../flow/agent/agentSandbox';
import { drawPicturesForAgent } from './imageCommand';

/*
 * `/agent`'s pictures: where the pictures `draw_image` draws wait for the answer. The run keeps
 * them on its state, so an answer given after a question still carries the picture drawn before it.
 */

/** `draw_image` for one run: draws on the page and keeps what came back on the run's state. */
export function agentPictureDrawer(state: AgentRunState): DrawImage {
  return async (prompt, provider) => {
    const drawing = await drawPicturesForAgent(prompt, provider);
    if (drawing.files.length > 0) {
      state.pictures = [...(state.pictures ?? []), ...drawing.files];
      state.updatedAt = new Date().toISOString();
      await saveRunState(state);
    }
    const paths = await Promise.all(drawing.files.map(agentReadPathFor));
    return {
      count: drawing.files.length,
      provider: drawing.providerLabel,
      reply: drawing.reply,
      paths: paths.filter((name): name is string => name !== null),
      ...(drawing.miss === 'limit' ? { limit: true } : {}),
      ...(drawing.instead ? { instead: drawing.instead } : {}),
    };
  };
}

/**
 * Keeps the pictures a built-in connector saved for one run (the metro map), like `draw_image`'s:
 * on the run's state, so the answer — or one given after a question — carries them.
 */
export function agentPictureKeeper(state: AgentRunState): (files: readonly string[]) => Promise<void> {
  return async (files) => {
    const fresh = files.filter((file) => !(state.pictures ?? []).includes(file));
    if (fresh.length === 0) return;
    state.pictures = [...(state.pictures ?? []), ...fresh];
    state.updatedAt = new Date().toISOString();
    await saveRunState(state);
  };
}

/**
 * The names in a run file's list that lie in the chat media folder. A bot sends these as they are,
 * and an edited run file must not name any other file on this computer.
 */
export function inChatMedia(files: unknown, dir?: string): string[] {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return [];
  const root = path.resolve(dir ?? chatMediaDir());
  return list.filter((file): file is string => typeof file === 'string' && file !== '' && path.dirname(path.resolve(file)) === root);
}

/** The pictures to send with the answer, as photos. */
export function runPictures(state: AgentRunState, dir?: string): string[] {
  return inChatMedia(state.pictures, dir);
}
