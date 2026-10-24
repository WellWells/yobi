import { clipboardApi, fileApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { conversationPlainMarkdown } from './conversationText';
import { fillTemplate } from '../../../../shared/fillTemplate';

type Translate = (key: string) => string;

/*
 * The sidebar's copy actions. Each one says it worked with the same notice the header's ⋮ shows
 * for the same action, so copying from either place reads the same.
 */

function confirmCopied(ok: boolean, message: string): void {
  if (!ok) return;
  showAppNotice({ message, level: 'success' });
}

/** The file's absolute path. */
export async function copyPathWithNotice(filePath: string, t: Translate): Promise<void> {
  confirmCopied(await clipboardApi.copyText(filePath), t('header.menu.copied.path'));
}

/** The conversation as plain Markdown: no `yobi:` markers (a pasted transcript would come with them). */
export async function copyFullTextWithNotice(filePath: string, t: Translate): Promise<void> {
  const raw = await fileApi.getContent(filePath);
  if (raw === null) return;
  confirmCopied(await clipboardApi.copyText(conversationPlainMarkdown(raw, { unsupported: t('notion.block.unsupported') })), t('header.menu.copied.full'));
}

/**
 * The files themselves, to paste into a folder or a mail. The notice counts what main put on the
 * clipboard: it skips a file that is gone, and the list can still show one deleted outside Yobi
 * (the watcher misses network drives).
 */
export async function copyFilesWithNotice(filePaths: string[], t: Translate): Promise<void> {
  if (filePaths.length === 0) return;
  const copied = await fileApi.copyFiles(filePaths);
  if (copied === 0) return;
  const message = copied === 1
    ? t('context.copied.file')
    : fillTemplate(t('selection.copied.files'), { count: String(copied) });
  showAppNotice({ message, level: 'success' });
}
