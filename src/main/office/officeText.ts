/**
 * OfficeCLI's answers name files by their full path (the argv it ran is absolute), and the answer
 * goes verbatim into a prompt for a third-party web UI. A Windows path carries the account name,
 * so each folder the model may use is written back the way the model knows it (`Documents/x.xlsx`,
 * `report.xlsx` for the output folder). Longest folder first: chat-media sits inside userData.
 */
export function sandboxedText(text: string, roots: ReadonlyArray<{ dir: string; name: string }>, platform: NodeJS.Platform): string {
  let out = text;
  const sorted = [...roots].filter((root) => root.dir).sort((a, b) => b.dir.length - a.dir.length);
  for (const { dir, name } of sorted) {
    const trimmed = dir.replace(/[\\/]+$/, '');
    const forms = platform === 'win32' ? [trimmed, trimmed.replace(/\\/g, '/'), trimmed.replace(/\\/g, '\\\\')] : [trimmed];
    for (const form of [...new Set(forms)]) {
      const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${escaped}(?:\\\\\\\\|[\\\\/])?`, platform === 'win32' ? 'gi' : 'g');
      out = out.replace(pattern, name === '.' ? '' : `${name}/`);
    }
  }
  return out;
}
