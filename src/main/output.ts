import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dayjs from 'dayjs';

interface SaveOptions {
  prompt: string;
  response: string;
  outputDir: string;
  title: string;
  provider?: string;
  promptLabel?: string;
  responseLabel?: string;
  timestampLabel?: string;
  providerLabel?: string;
}

export async function saveOutput({
  prompt,
  response,
  outputDir,
  title,
  provider,
  promptLabel = 'Prompt',
  responseLabel = 'Response',
  timestampLabel = 'Time',
  providerLabel = 'Provider',
}: SaveOptions): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const fileDate = dayjs().format('YYYY-MM-DD-HH-mm-ss');
  const timestamp = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');
  const filename = `${fileDate}.md`;
  const filePath = path.join(outputDir, filename);

  const content = [
    `# ${title}`,
    '',
    ...(provider ? [`## ${providerLabel}`, '', provider, ''] : []),
    `## ${timestampLabel}`,
    '',
    timestamp,
    '',
    `## ${promptLabel}`,
    '',
    prompt,
    '',
    `## ${responseLabel}`,
    '',
    response,
    '',
  ].join('\n');

  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}
