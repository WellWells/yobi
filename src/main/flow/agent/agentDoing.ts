import { normalizeTitle } from '../../../shared/conversationTitle';
import { cleanRecap } from '../../../shared/recap';
import { IDENTIFIER, NON_LATIN_LETTER, holdsWebAddress, namesToolId, withoutUnseen } from '../../../shared/agentStepLabel';
import { maskSecrets } from './secretMask';

export { IDENTIFIER, NON_LATIN_LETTER };

/** Longest step title kept, in code points: one line beside the seconds and the chevron. */
export const DOING_MAX = 60;

/** How much of a reply's value is read at all: the link pattern below is quadratic on `[[[[`. */
const DOING_SCAN = DOING_MAX * 8;

/** The prompt's own wording, copied instead of filled in. */
const PLACEHOLDER = /few words|answer language|no tool names|^string$/i;

/**
 * The model's title for a step, or nothing. A cosmetic field: read after validation, and a bad one
 * is a missing one, so it can never cost a repair round trip. `tool` is '' for a batch-level title,
 * which belongs to no tool.
 */
export function readDoing(obj: Record<string, unknown>, tool: string): { doing?: string } {
  if (typeof obj.doing !== 'string') return {};
  const plain = withoutUnseen(obj.doing.slice(0, DOING_SCAN))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*<(.*)>\s*$/s, '$1');
  const line = cleanRecap(normalizeTitle(maskSecrets(plain, false)), DOING_MAX);
  if (!line || IDENTIFIER.test(line) || holdsWebAddress(line) || PLACEHOLDER.test(line)) return {};
  return namesToolId(line, tool) ? {} : { doing: line };
}
