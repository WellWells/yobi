import type { Task } from '../../shared/types';

/**
 * The user pressed Stop on a chat send. Unlike the queue's skip, a stopped task really ends: a BYOK
 * request is aborted, a web provider's page is told to stop generating, and whatever answer still
 * arrives is dropped instead of written into the conversation.
 */
export class TaskStoppedError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} was stopped by the user`);
    this.name = 'TaskStoppedError';
  }
}

const controllers = new WeakMap<Task, AbortController>();

function controllerFor(task: Task): AbortController {
  let controller = controllers.get(task);
  if (!controller) {
    controller = new AbortController();
    controllers.set(task, controller);
  }
  return controller;
}

/** Aborted once the user stops this task; shared by every attempt, fallback providers included. */
export function taskStopSignal(task: Task): AbortSignal {
  return controllerFor(task).signal;
}

export function stopTask(task: Task): void {
  controllerFor(task).abort(new TaskStoppedError(task.id));
}

export function wasStopped(task: Task): boolean {
  return controllers.get(task)?.signal.aborted === true;
}

export function throwIfStopped(task: Task): void {
  if (wasStopped(task)) throw new TaskStoppedError(task.id);
}

const STOP_RETRY_MS = 1_000;

/**
 * Clicks the site's own stop once the send is stopped, and keeps trying while the page has none
 * to click: Stop pressed while the page still loads or the prompt is still being typed finds no
 * control yet, and a single try would leave the whole answer generating behind a dropped turn.
 * Also fires for a signal already aborted, which a listener added now would never hear.
 * Returns the release to call when the send ends; nothing is clicked after it.
 */
export function stopPageOnAbort(
  signal: AbortSignal,
  click: () => Promise<boolean>,
  onResult: (clicked: boolean) => void,
  retryMs = STOP_RETRY_MS,
): () => void {
  let ended = false;
  let tried = false;
  let clicked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = async (): Promise<void> => {
    if (ended) return;
    tried = true;
    clicked = await click().catch(() => false);
    if (ended) return;
    if (clicked) {
      onResult(true);
      return;
    }
    timer = setTimeout(() => { void attempt(); }, retryMs);
  };
  const onAbort = (): void => { void attempt(); };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return () => {
    if (ended) return;
    ended = true;
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    if (tried && !clicked) onResult(false);
  };
}
