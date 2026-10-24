/**
 * The rule every mail-sending connector shares: a file attached to outgoing mail must be one the
 * `/agent` read sandbox would let the model read, so mailing a file is never a way around it. The
 * absolute path that passed replaces what the model wrote.
 */
import { denyReasonForFileTool, getAgentFileRoots } from '../flow/agent/agentSandbox';
import { resolveUserPath } from '../flow/skills/fileOps';
import { applyAttachmentPolicy, type CallVerdict } from '../thunderbird/attachmentPolicy';

export function prepareAttachmentCall(args: Record<string, unknown>): Promise<CallVerdict> {
  return applyAttachmentPolicy(args, async (raw) => {
    const denied = await denyReasonForFileTool('file_read', { path: raw }, await getAgentFileRoots());
    return denied ? { denied } : { path: await resolveUserPath(raw) };
  });
}
