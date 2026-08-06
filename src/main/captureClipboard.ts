import { clipboard, nativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import AdmZip from 'adm-zip';
import { captureRidesAsFile } from '../shared/types';
import { sendLog } from './helpers';

export function zipSingleFile(buffer: Buffer, entryName: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(entryName, buffer);
  return zip.toBuffer();
}

function copyFileToClipboard(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return new Promise<void>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', 'Set-Clipboard -LiteralPath $env:YOBI_CLIP_PATH'],
        { env: { ...process.env, YOBI_CLIP_PATH: filePath } },
        () => resolve(),
      );
    });
  }
  if (process.platform === 'darwin') {
    clipboard.writeBuffer('public.file-url', Buffer.from(`file://${filePath}`, 'utf-8'));
  } else {
    clipboard.writeBuffer('text/uri-list', Buffer.from(`file://${filePath}`, 'utf-8'));
  }
  return Promise.resolve();
}

export async function writeCaptureToClipboard(
  buffer: Buffer,
  ext: string,
  fileStem: string,
  zip: boolean,
): Promise<void> {
  if (!captureRidesAsFile(ext, zip)) {
    clipboard.writeImage(nativeImage.createFromBuffer(buffer));
    sendLog('📋 Image copied to clipboard');
    return;
  }

  const outExt = zip ? 'zip' : ext;
  const tmpPath = path.join(os.tmpdir(), `${fileStem}.${outExt}`);
  await fs.writeFile(tmpPath, zip ? zipSingleFile(buffer, `${fileStem}.${ext}`) : buffer);
  await copyFileToClipboard(tmpPath);
  sendLog(`📋 ${outExt.toUpperCase()} copied as temp file: ${tmpPath}`);
}
