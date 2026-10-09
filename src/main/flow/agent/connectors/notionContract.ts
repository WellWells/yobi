import { boundaryForRisk, confirmForRisk, interpretGeneric } from '../toolContracts';
import type { ActionBoundary, Args, ToolContract, ToolRisk } from '../toolContracts';

/**
 * `notion-update-page` deletes content only with `allow_deleting_content: true`, so its tool-wide
 * `destructiveHint` is not taken at face value.
 */
function deletesContent(args: Args): boolean {
  const flag = args.allow_deleting_content;
  return flag === true || String(flag).trim().toLowerCase() === 'true';
}

interface ContentUpdate {
  old_str: string;
  new_str: string;
}

/** The search-and-replace pairs, read from `content_updates` or, as models first write them, the top level. */
function contentUpdates(args: Args): ContentUpdate[] {
  const raw = Array.isArray(args.content_updates) ? args.content_updates : [args];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { old_str: from, new_str: to } = item as Record<string, unknown>;
    return typeof from === 'string' ? [{ old_str: from, new_str: typeof to === 'string' ? to : '' }] : [];
  });
}

/**
 * An update that takes text away rather than changing it: a replacement left empty, or the
 * replacements together less than half of what they replace. Moving a line keeps the length, so it
 * stays an edit; blanking a paragraph is asked every time, whatever "always allow" says.
 */
function removesText(args: Args): boolean {
  if (args.command !== 'update_content') return false;
  const updates = contentUpdates(args);
  if (updates.some((update) => !update.new_str.trim())) return true;
  const removed = updates.reduce((sum, update) => sum + update.old_str.length, 0);
  const added = updates.reduce((sum, update) => sum + update.new_str.length, 0);
  return added * 2 < removed;
}

function updatePageRisk(args: Args): ToolRisk {
  if (deletesContent(args) || args.command === 'replace_content' || removesText(args)) return 'destructive';
  return 'mutating';
}

/** What the call edits: the replaced text or the inserted content, clipped. */
function editedText(args: Args): string {
  const updates = contentUpdates(args);
  if (updates.length > 0) return updates.map((update) => update.old_str).join('\u0000');
  return typeof args.content === 'string' ? args.content : '';
}

function updatePageBoundary(args: Args): ActionBoundary | null {
  return deletesContent(args) ? 'delete' : boundaryForRisk('mutating');
}

const UPDATE_PAGE: ToolContract = {
  risk: updatePageRisk,
  boundary: updatePageBoundary,
  confirm: (args) => confirmForRisk(updatePageRisk(args)),
  interpret: (text, isError) => interpretGeneric(text, isError, 'notion-update-page'),
  // Page + command + edited text: a malformed first try that a retry fixed is not reported as a
  // failure, while a failed edit elsewhere on the same page still is.
  targetKey: (args) => {
    const page = typeof args.page_id === 'string' ? args.page_id.replace(/-/g, '').toLowerCase() : '';
    return page ? `notion-page:${page}:${String(args.command ?? '')}:${editedText(args).slice(0, 200)}` : null;
  },
};

export const NOTION_CONTRACTS: Readonly<Record<string, ToolContract>> = {
  'notion-update-page': UPDATE_PAGE,
};

export const NOTION_NOTES = [
  'NOTION NOTES:',
  '- Edit page text with notion-update-page "command": "update_content", "content_updates": [{"old_str": <copied exactly from a fetch>, "new_str": …}]; add with "insert_content". Moving a line is one update whose old_str spans both places.',
  '- A parent page ("parent" in notion-create-pages, "new_parent" in notion-move-pages) is {"type": "page_id", "page_id": "…"} — the type is literally "page_id".',
  '- There is no delete tool, and update_properties cannot trash a page. To delete a page, remove its <page url="…"> tag from its parent page that way (new_str "") with "allow_deleting_content": true; a page with no parent is first moved under one with notion-move-pages. notion-restore-pages undoes it.',
].join('\n');
