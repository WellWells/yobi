import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import dayjs from 'dayjs';

interface MarkdownOptions {
  prompt: string;
  response: string;
  title: string;
  provider?: string;
  promptLabel?: string;
  responseLabel?: string;
  timestampLabel?: string;
  providerLabel?: string;
}

interface SaveOptions extends MarkdownOptions {
  outputDir: string;
}

// Shared markdown shape for saved replies AND in-memory temporary-chat replies,
// so both render identically in the chat view.
export function buildOutputMarkdown({
  prompt,
  response,
  title,
  provider,
  promptLabel = 'Prompt',
  responseLabel = 'Response',
  timestampLabel = 'Time',
  providerLabel = 'Provider',
}: MarkdownOptions): string {
  const timestamp = dayjs().format('YYYY-MM-DDTHH:mm:ssZ');
  return [
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
}

export async function saveOutput({ outputDir, ...markdownOptions }: SaveOptions): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });

  const fileDate = dayjs().format('YYYY-MM-DD-HH-mm-ss');
  const filename = `${fileDate}.md`;
  const filePath = path.join(outputDir, filename);

  await fs.writeFile(filePath, buildOutputMarkdown(markdownOptions), 'utf-8');
  return filePath;
}
