import * as fs from 'node:fs/promises';

/**
 * Windows' "came from the internet" mark (Mark of the Web): Office opens such a file in Protected
 * View and SmartScreen checks it before it runs. Best effort; other systems have no such stream.
 */
export async function markFromInternet(file: string): Promise<void> {
  if (process.platform !== 'win32') return;
  await fs.writeFile(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n').catch(() => {});
}
