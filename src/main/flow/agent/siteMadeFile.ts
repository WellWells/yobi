/**
 * A browser chat site can make files on its own — Gemini's document export, ChatGPT's code runner
 * with its `sandbox:/mnt/data/` download link, Claude's artifacts — and a model asked for "a Word
 * report" often does, then answers in prose that the file is done. No such file ever reaches the
 * user or a tool, so the bare "No JSON object" rejection is the wrong thing to tell it: it says what
 * was wrong with the reply, not that the file it believes it made does not exist here.
 *
 * Read only when the reply holds no JSON at all, and only for a browser run (a BYOK endpoint has
 * no file features of its own). Language-free: the reply is in the user's language, so it is read by
 * file names and the download scheme, never by words like "download" or "匯出".
 */

/**
 * Document-like files a site makes on request; images are left out (`draw_image` covers those).
 * The name stops at ASCII and CJK punctuation, so "Word 文件（.docx）" is no file name of its own.
 */
const DOCUMENT_FILE = /[^\s"'`<>()[\]{}|*\\/:（）「」『』《》【】〔〕、，。：；！？]+\.(?:docx?|pptx?|xlsx?|pdf|csv|odt|ods|odp|rtf|zip)(?![\p{L}\p{N}])/iu;

const SITE_DOWNLOAD = /sandbox:\/mnt\/data\/([^\s"'`<>()[\]]+)/i;

/**
 * A file kind on its own: ChatGPT's file card copies out as "DOCX · 已建立並完成檔案檢查 … 下載 Word
 * 專題報導", with no file name and no link. Only the Office kinds — a bare "PDF" or "CSV"
 * is as often the format a prose answer talks about as a file the site made.
 */
const FILE_KIND = /(?<![\p{L}\p{N}._-])(docx|pptx|xlsx)(?![\p{L}\p{N}])/iu;

const FILE_NAME_MAX = 80;

/** The file a no-JSON reply names, or undefined when it names none. */
export function siteMadeFileName(raw: string): string | undefined {
  const name = raw.match(SITE_DOWNLOAD)?.[1] ?? raw.match(DOCUMENT_FILE)?.[0];
  return name === undefined ? undefined : name.slice(0, FILE_NAME_MAX);
}

/**
 * The file a finish names that nothing in this run holds — not the GOAL, the conversation, nor any
 * tool's config or observation. Told its site-made file never reaches the user, ChatGPT can
 * answer "finish": "已找到並確認現有 Word 文件：….docx" with no step taken — the file of an earlier
 * chat, which it recalls through its own memory — and the run would mark itself complete.
 */
export function unseenFileInAnswer(answer: string, evidence: readonly string[]): string | undefined {
  const name = siteMadeFileName(answer);
  if (name === undefined) return undefined;
  const wanted = name.toLowerCase();
  return evidence.some((text) => text.toLowerCase().includes(wanted)) ? undefined : name;
}

export function unseenFileError(name: string): string {
  return [
    `The answer names a file ("${name}") that no step of this run made or read.`,
    'A file this chat site made, here or in another chat, never reaches the user.',
    'Make it with a tool listed under TOOLS or MCP TOOLS, or finish without claiming a file.',
  ].join(' ');
}

/** How the rejection refers to the file: its name, else its kind ("a DOCX file"). */
function describeSiteFile(raw: string): string | undefined {
  const name = siteMadeFileName(raw);
  if (name !== undefined) return `a file ("${name}")`;
  const kind = raw.match(FILE_KIND)?.[1];
  return kind === undefined ? undefined : `a ${kind.toUpperCase()} file`;
}

/**
 * The rejection for a no-JSON reply that names a file; undefined leaves the generic one. Covers the
 * reply that reports a file a tool really made too, so it never claims the file is missing.
 */
export function siteMadeFileError(raw: string): string | undefined {
  const file = describeSiteFile(raw);
  if (file === undefined) return undefined;
  return [
    `No JSON object was found in the response. It speaks of ${file}.`,
    'A file this chat site makes with its own features (a canvas, a code runner, an export or a download link)',
    'never reaches the user — only a file made by a tool listed under TOOLS or MCP TOOLS does.',
    'If a tool already made it, put the answer in "finish"; otherwise call the tool that makes it.',
  ].join(' ');
}
