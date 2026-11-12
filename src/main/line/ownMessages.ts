/**
 * What the LINE PC bot (`src/main/lineSelf/`) reads each time LINE stores something: every new row
 * in a group (`c…`, from anyone — whoever writes there may be talking to it), the user's own rows
 * in any chat (their "Yobi" works in a 1:1 chat too), and of the other side of a 1:1 chat only the
 * text lines that start with "Yobi" (a friend asking the user's Yobi).
 * Rows are taken by SQLite's rowid, which grows with every insert, so a message LINE syncs late
 * (sent from the phone while this PC was offline) still counts as new; a table without one falls
 * back to `_createdTime`.
 */
import { mentionSpans, parseMeta, type MentionSpan } from './lineMessageParts';
import type { ReaderAccess } from './reader';
import { parseMessageRow, type MessageRow, type ParsedMessage } from './schema';

const MESSAGE_TABLE = '_message';
const NO_NAMES = new Map<string, string>();

/** Where reading resumes: past this row id when the table has row ids, else past this time. */
export interface MessageMark {
  /** The table has SQLite row ids (an empty one too: its first row counts from 0). */
  byRow: boolean;
  rowId: number;
  createdMs: number;
}

/** One stored row; `message.from_me` marks the user's own, `message.sender_id` says who wrote it. */
export interface WatchedMessage {
  rowId: number;
  chatId: string;
  createdMs: number;
  message: ParsedMessage;
  /** Who it @-mentions and where in its text: the parsed message keeps line-cli's shape, without spans. */
  mentions: MentionSpan[];
}

type Access = Pick<ReaderAccess, 'all' | 'get' | 'columns'>;

/** The newest stored row: everything already there is history, not something to answer. */
export function latestMessageMark(access: Access): MessageMark {
  // Two queries: a table without rowid fails only the second (a missing column reads as no row,
  // while an empty table answers one row holding null).
  const createdMs = Number(access.get(`SELECT max(_createdTime) AS t FROM ${MESSAGE_TABLE}`)?.t) || 0;
  const latestRow = access.get(`SELECT max(rowid) AS r FROM ${MESSAGE_TABLE}`);
  return { byRow: latestRow !== undefined, rowId: Number(latestRow?.r) || 0, createdMs };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

/** Full-width letters and "＠" as their ASCII forms, the way `addressedText` takes them. */
const WAKE_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ['ｙ', 'y'], ['Ｙ', 'y'], ['ｏ', 'o'], ['Ｏ', 'o'], ['ｂ', 'b'], ['Ｂ', 'b'], ['ｉ', 'i'], ['Ｉ', 'i'], ['＠', '@'],
];
/** What `ltrim` takes off the front: the blanks a line may start with before "Yobi". */
const LEADING_BLANKS = ' \t\r\n　';

/**
 * A row's text starts with "Yobi" or "@Yobi", in any case and full-width — a prefilter only, so the
 * other side of a 1:1 chat is read no further than its wake-word lines; `addressedText` decides.
 * SQLite's LIKE folds ASCII case only, so full-width letters are folded first.
 */
function wakeWordPrefilter(): string {
  const folded = WAKE_FOLDS.reduce((expr, [from, to]) => `replace(${expr}, '${from}', '${to}')`, `ltrim(coalesce(_text, ''), '${LEADING_BLANKS}')`);
  return `(${folded} LIKE 'yobi%' OR ${folded} LIKE '@yobi%')`;
}

/**
 * The rows stored after `mark`, oldest first: everyone's in groups, the user's own (`ownIds`) in
 * any chat, and in a 1:1 chat (`u…`, whose id is the other person's) their text rows that start
 * with "Yobi" — nothing else of theirs. Names are not resolved: the bot asks for the few it needs.
 */
export function watchedMessagesAfter(
  access: Access,
  mark: MessageMark,
  opts: { ownIds: ReadonlySet<string>; limit: number },
): WatchedMessage[] {
  const own = [...opts.ownIds];
  const byRow = mark.byRow;
  const scope = ["substr(_chatId, 1, 1) = 'c'"];
  // A column this database lacks would make the whole query read as no rows (`safeAll`): the
  // groups and the user's own lines must not go quiet for the sake of a friend's "Yobi".
  const stored = access.columns(MESSAGE_TABLE);
  if (stored.has('_text') && stored.has('_contentType')) {
    scope.push(`(substr(_chatId, 1, 1) = 'u' AND _from = _chatId AND coalesce(_contentType, 0) = 0 AND ${wakeWordPrefilter()})`);
  }
  const params: unknown[] = [byRow ? mark.rowId : mark.createdMs];
  if (own.length > 0) {
    scope.push(`_from IN (${placeholders(own.length)})`);
    params.push(...own);
  }
  const after = byRow ? 'rowid > ?' : '_createdTime > ?';
  const columns = byRow ? 'rowid AS _rowid, *' : '*';
  const order = byRow ? 'rowid' : '_createdTime';
  const rows = access.all(
    `SELECT ${columns} FROM ${MESSAGE_TABLE} WHERE ${after} AND (${scope.join(' OR ')}) ORDER BY ${order} ASC LIMIT ?`,
    [...params, opts.limit],
  );
  return rows.map((row) => {
    const stored = row as MessageRow;
    return {
      rowId: Number(row._rowid) || 0,
      chatId: String(row._chatId ?? ''),
      createdMs: Number(row._createdTime) || 0,
      message: parseMessageRow(stored, NO_NAMES, opts.ownIds),
      mentions: mentionSpans(parseMeta(stored._contentMetadata), stored._text ?? ''),
    };
  });
}
