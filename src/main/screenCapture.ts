import { desktopCapturer, screen, systemPreferences } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getOutputDir, buildSnapshotFileName, getUniquePath } from './files';
import { sendLog } from './helpers';

export type ScreenCaptureFormat = 'png' | 'jpg';

export async function captureScreenToFile(format: ScreenCaptureFormat, targetDir?: string): Promise<string> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'denied' || status === 'restricted') {
      throw new Error('Screen recording permission is required — enable it in System Settings › Privacy & Security › Screen Recording.');
    }
  }

  const primary = screen.getPrimaryDisplay();
  const width = Math.round(primary.size.width * primary.scaleFactor);
  const height = Math.round(primary.size.height * primary.scaleFactor);

  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  if (sources.length === 0) throw new Error('No screen source available to capture');
  const source = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];

  const image = source.thumbnail;
  if (image.isEmpty()) throw new Error('Captured screen image is empty (screen recording permission may be required)');

  const buffer = format === 'jpg' ? image.toJPEG(92) : image.toPNG();
  const outputDir = targetDir?.trim() ? targetDir.trim() : await getOutputDir();
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = await getUniquePath(path.join(outputDir, `${buildSnapshotFileName()}.${format}`), '');
  await fs.writeFile(filePath, buffer);
  sendLog(`🖼️ [AgentFlow] Screen captured: ${path.basename(filePath)}`);
  return filePath;
}
