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

/** What the user typed themself: pasted code blocks and quoted text are someone else's words. */
function ownWords(text: string): string {
  return (text ?? '')
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');
}

const TIDY_ZH = '整理|統整|统整|精簡|精简|壓縮|压缩|清理|清一清|合併|合并|去重|歸納|归纳|最佳化|優化|优化';
/** The Chinese word for memory, but not RAM, memory card or the faculty of memory; the gap stops at the end of a sentence, so two sentences never pair up. */
const MEMORY_ZH = '(?:記憶|记忆)(?!體|体|卡|力)';
/** Stems, so "consolidating" and "tidied" count as well. */
const TIDY_EN = '(?:tid(?:y|i)|clean|organi[sz]|reorgani[sz]|consolidat|compress|dedup|de-?duplicat|compact|prun|optimi[sz]|merg)\\w*';
/** What follows "memory" in a question about a program: "my memory usage" is RAM, not the user's facts. */
const TECHNICAL_EN = '(?:usage|use|leaks?|footprint|allocat\\w*|consumption|limits?|pressure|cards?|sticks?|bandwidth|profil\\w*|dumps?|management|bloat|layout|address\\w*|maps?|regions?|buffers?|pools?|pages?|safety|model|barriers?|cache)';
/** "optimize memory usage" is a programming question; only the user's own memory counts. */
const MEMORY_EN = `\\b(?:my|your|saved|personal)\\s+memor(?:y|ies)\\b(?!\\s+${TECHNICAL_EN}\\b)`;

const TIDY_INTENT_RE = new RegExp([
  `(?:${TIDY_ZH})[^。！？!?；;\\n]{0,12}${MEMORY_ZH}`,
  `${MEMORY_ZH}[^。！？!?；;\\n]{0,12}(?:${TIDY_ZH})`,
  `\\b${TIDY_EN}\\b[^.!?;\\n]{0,30}${MEMORY_EN}`,
  `${MEMORY_EN}[^.!?;\\n]{0,30}\\b${TIDY_EN}`,
].join('|'), 'i');

/** Asking to keep or drop something, in the words people use for it; no noun needed. */
const REMEMBER_ZH = [
  '記住', '記得', '記一下', '記下來', '別忘', '不要忘', '忘掉', '忘記', '不要記', '別記',
  '记住', '记得', '记一下', '记下来', '别忘', '忘掉', '忘记', '不要记', '别记',
];
const CHANGE_ZH = '更新|修改|改掉|改成|改為|改为|刪除|删除|刪掉|删掉|清除|清空|移除|新增|增加|添加|加入|加到|加進|加进|放進|放进|放到|存進|存进|存到|存入|存成|存為|存为|記進|记进|記到|记到|寫進|写进|寫入|写入|寫到|写到';
/** The noun as what is added to, kept in or dropped from — not "memory" as the subject of a question. */
const MEMORY_EN_OBJECT = `memor(?:y|ies)\\b(?!\\s+${TECHNICAL_EN}\\b)`;

/**
 * A request to change the personal memory. The bare noun is not one (the Chinese word also forms
 * "RAM", and "memory leak" is a program), and a turn that read outside content must not unlock on
 * either, so the noun counts only as the user's own memory or as the object of a change.
 */
const INTENT_RE = new RegExp([
  ...REMEMBER_ZH,
  '\\bremember\\b', '\\bforget\\b', '\\bmemori[sz]e\\b',
  `(?:我的|你的|個人|个人|保存的|儲存的|储存的|存的)\\s*${MEMORY_ZH}`,
  `${MEMORY_ZH}(?:裡|里|中)`,
  `(?:${CHANGE_ZH})[^。！？!?；;\\n]{0,12}${MEMORY_ZH}`,
  `${MEMORY_ZH}[^。！？!?；;\\n]{0,12}(?:${CHANGE_ZH})`,
  MEMORY_EN,
  `\\b(?:add|save)\\b[^.!?;\\n]{0,30}\\b(?:to|into)\\s+(?:the\\s+)?${MEMORY_EN_OBJECT}`,
  `\\b(?:delete|remove|update|edit|erase)\\s+(?:that|this|the)\\s+${MEMORY_EN_OBJECT}`,
].join('|'), 'i');

/** A tidy request is a memory request too, so its review survives a turn that read outside content. */
export function hasExplicitMemoryIntent(userText: string): boolean {
  return INTENT_RE.test(ownWords(userText)) || hasTidyIntent(userText);
}

/**
 * The user asked, in their own words, for the memory as a whole to be tidied. Checked here because
 * a model asked to tidy may rewrite and delete entries directly instead of requesting a review.
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
