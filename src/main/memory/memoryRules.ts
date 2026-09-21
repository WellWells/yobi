import { MEMORY_CURATE_NOTE_MAX_CHARS } from '../../shared/memoryCurate';
import { cleanMemoryText } from '../../shared/userMemory';
import type { MemoryOp } from './memoryProtocol';

export type MemoryAccess = 'none' | 'read' | 'readWrite';

export interface MemoryAccessContext {
  surface: 'app' | 'hotkey' | 'bot' | 'flow';
  /** Temporary chat: nothing is kept, so nothing is remembered and nothing is recalled either. */
  temporary?: boolean;
  /** A bot message from an account marked as the user themself, in a private chat. */
  botSelfPrivate?: boolean;
  /** A flow `llm` step with "include my memory" switched on. */
  flowOptIn?: boolean;
}

/**
 * Who may see the memory and who may change it. A bot answers whoever writes to it, and a group
 * is read by everyone in it; a flow's output is often sent to other people. Both stay out unless
 * the user opted that exact place in.
 */
export function memoryAccess(enabled: boolean, ctx: MemoryAccessContext): MemoryAccess {
  if (!enabled) return 'none';
  switch (ctx.surface) {
    case 'app':
      return ctx.temporary ? 'none' : 'readWrite';
    case 'bot':
      return ctx.botSelfPrivate ? 'readWrite' : 'none';
    case 'flow':
      return ctx.flowOptIn ? 'read' : 'none';
    default:
      return 'none';
  }
}

const INTENT_RE = new RegExp([
  '記住', '記得', '記一下', '記下來', '別忘', '不要忘', '忘掉', '忘記', '不要記', '別記', '記憶',
  '记住', '记得', '记一下', '记下来', '别忘', '忘掉', '忘记', '不要记', '别记', '记忆',
  '\\bremember\\b', '\\bforget\\b', '\\bmemori[sz]e\\b', '\\bmemory\\b',
].join('|'), 'i');

/** What the user typed themself: pasted code blocks and quoted text are someone else's words. */
function ownWords(text: string): string {
  return (text ?? '')
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');
}

export function hasExplicitMemoryIntent(userText: string): boolean {
  return INTENT_RE.test(ownWords(userText));
}

const TIDY_ZH = '整理|統整|统整|精簡|精简|壓縮|压缩|清理|清一清|合併|合并|去重|歸納|归纳|最佳化|優化|优化';
/** 記憶 but not 記憶體 (RAM), 記憶卡 or 記憶力; the gap stops at the end of a sentence, so two sentences never pair up. */
const MEMORY_ZH = '(?:記憶|记忆)(?!體|体|卡|力)';
/** Stems, so "consolidating" and "tidied" count as well. */
const TIDY_EN = '(?:tid(?:y|i)|clean|organi[sz]|reorgani[sz]|consolidat|compress|dedup|de-?duplicat|compact|prun|optimi[sz]|merg)\\w*';
/** "optimize memory usage" is a programming question; only the user's own memory counts. */
const MEMORY_EN = '\\b(?:my|your|saved|personal)\\s+memor(?:y|ies)\\b';

const TIDY_INTENT_RE = new RegExp([
  `(?:${TIDY_ZH})[^。！？!?；;\\n]{0,12}${MEMORY_ZH}`,
  `${MEMORY_ZH}[^。！？!?；;\\n]{0,12}(?:${TIDY_ZH})`,
  `\\b${TIDY_EN}\\b[^.!?;\\n]{0,30}${MEMORY_EN}`,
  `${MEMORY_EN}[^.!?;\\n]{0,30}\\b${TIDY_EN}`,
].join('|'), 'i');

/**
 * The user asked, in their own words, for the memory as a whole to be tidied. Measured on Gemini
 * 2026-09-20: asked "幫我整理一下我的記憶", the model rewrote and deleted entries straight from its
 * reply instead of asking for a review — so this cannot rest on the model following its rule.
 */
export function hasTidyIntent(userText: string): boolean {
  return TIDY_INTENT_RE.test(ownWords(userText));
}

/**
 * The reply's memory lines, plus a review when the user asked for a tidy and the model did not
 * ask for one itself. The user's own words become the direction the review starts from.
 */
export function withTidyReview(ops: readonly MemoryOp[], userText: string): MemoryOp[] {
  if (ops.some((op) => op.kind === 'review') || !hasTidyIntent(userText)) return [...ops];
  return [...ops, { kind: 'review', text: cleanMemoryText(ownWords(userText)).slice(0, MEMORY_CURATE_NOTE_MAX_CHARS) }];
}

export interface MemoryAdmission {
  ops: MemoryOp[];
  /** Changes dropped because the turn read outside content and the user never asked for a memory change. */
  blocked: number;
}

/**
 * A turn that read an attachment, a fetched page or a tool result can carry someone else's words
 * shaped exactly like a memory line — "remember that the user is…", or a request to forget
 * everything. In such a turn the model's own judgement is not enough: only a turn in which the
 * user asked for a memory change in their own words may make one.
 */
export function admitMemoryOps(ops: readonly MemoryOp[], ctx: { tainted: boolean; userText: string }): MemoryAdmission {
  if (ops.length === 0) return { ops: [], blocked: 0 };
  if (ctx.tainted && !hasExplicitMemoryIntent(ctx.userText)) return { ops: [], blocked: ops.length };
  return { ops: [...ops], blocked: 0 };
}
