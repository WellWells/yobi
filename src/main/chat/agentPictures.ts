import * as path from 'node:path';
import type { AgentRunState } from '../../shared/types';
import { chatMediaDir } from '../chatMedia';
import type { DrawImage } from '../flow/agent/agentDrawImage';
import { saveRunState } from '../flow/agent/agentRunStore';
import { drawPicturesForAgent } from './imageCommand';

/*
 * `/agent`'s pictures: where the pictures `draw_image` draws wait for the answer. The run keeps
 * them on its state, so an answer given after a question still carries the picture drawn before it.
 */

/** `draw_image` for one run: draws on the page and keeps what came back on the run's state. */
export function agentPictureDrawer(state: AgentRunState, discardChatgpt: boolean): DrawImage {
  return async (prompt, provider) => {
    const drawing = await drawPicturesForAgent(prompt, provider, discardChatgpt);
    if (drawing.files.length > 0) {
      state.pictures = [...(state.pictures ?? []), ...drawing.files];
      state.updatedAt = new Date().toISOString();
      await saveRunState(state);
    }
    return {
      count: drawing.files.length,
      provider: drawing.providerLabel,
      reply: drawing.reply,
      ...(drawing.miss === 'limit' ? { limit: true } : {}),
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
 * The pictures to send with the answer. Read from a run file, so only names inside the chat media
 * folder count: a bot sends these as photos, and an edited run file must not name any other file.
 */
export function runPictures(state: AgentRunState, dir?: string): string[] {
  const pictures = Array.isArray(state.pictures) ? state.pictures : [];
  if (pictures.length === 0) return [];
  const root = path.resolve(dir ?? chatMediaDir());
  return pictures.filter((file): file is string => {
    if (typeof file !== 'string' || !file) return false;
    const resolved = path.resolve(file);
    return path.dirname(resolved) === root;
  });
}
