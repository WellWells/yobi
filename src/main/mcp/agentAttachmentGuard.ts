/**
 * The rule every connector that sends a file out shares (mail attachments, LINE's line_send): the
 * file must be one the `/agent` read sandbox would let the model read, so sending a file is never a
 * way around it. The absolute path that passed replaces what the model wrote. `key` names the
 * argument that holds the paths.
 */
import { denyReasonForFileTool, getAgentFileRoots, resolveAgentReadPath } from '../flow/agent/agentSandbox';
import { applyAttachmentPolicy, type CallVerdict } from '../thunderbird/attachmentPolicy';

export function prepareAttachmentCall(args: Record<string, unknown>, key = 'attachments'): Promise<CallVerdict> {
  return applyAttachmentPolicy(args, async (raw) => {
    const denied = await denyReasonForFileTool('file_read', { path: raw }, await getAgentFileRoots());
    return denied ? { denied } : { path: await resolveAgentReadPath(raw) };
  }, key);
}

/**
 * line_send's `file` (one path or a list) through the same read sandbox, as a list: an empty
 * string is no path, and a single path is checked like a list of one.
 */
export function prepareLineSendCall(args: Record<string, unknown>): Promise<CallVerdict> {
  const file = args.file;
  if (file === undefined || file === null) return Promise.resolve({ args });
  const list = (Array.isArray(file) ? file : [file]).filter((entry) => entry !== '');
  return prepareAttachmentCall({ ...args, file: list }, 'file');
}

/** One path a connector reads and sends out: the same check, and the absolute path that passed. */
export async function prepareReadPathCall(args: Record<string, unknown>, key = 'path'): Promise<CallVerdict> {
  const raw = args[key];
  if (typeof raw !== 'string' || !raw.trim()) return { args };
  const denied = await denyReasonForFileTool('file_read', { path: raw }, await getAgentFileRoots());
  return denied ? { denied } : { args: { ...args, [key]: await resolveAgentReadPath(raw) } };
}
