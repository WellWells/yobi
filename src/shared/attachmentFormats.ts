import type { Provider } from './types';

const UPLOADABLE_MIMES = new Set([
  'application/pdf',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

export const UPLOADABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff',
  'pdf', 'rtf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
]);

const TEXT_MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/x-javascript',
  'application/typescript',
  'application/sql',
  'application/x-sh',
  'application/x-httpd-php',
  'image/svg+xml',
]);

export const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'adoc',
  'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml', 'toml',
  'ini', 'cfg', 'conf', 'env', 'properties', 'log', 'sql', 'diff', 'patch',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'dart', 'scala', 'clj', 'ex', 'exs',
  'c', 'h', 'cpp', 'cxx', 'cc', 'hpp', 'hxx', 'cs', 'm', 'mm',
  'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'lua', 'pl', 'pm', 'r', 'jl', 'hs', 'elm', 'nim', 'zig',
  'vue', 'svelte', 'astro', 'graphql', 'gql', 'proto', 'tf', 'tfvars',
  'gitignore', 'gitattributes', 'editorconfig', 'dockerfile', 'makefile', 'gradle',
]);

export function extensionOf(fileName: string | undefined): string {
  if (!fileName) return '';
  const base = fileName.trim().toLowerCase().replace(/\\/g, '/').split('/').pop() ?? '';
  if (!base) return '';
  const dot = base.lastIndexOf('.');
  if (dot === 0) return base.slice(1);
  if (dot < 0) return base;
  return base.slice(dot + 1);
}

export function normalizeMime(mimeType: string | undefined): string {
  return (mimeType ?? '').trim().toLowerCase().split(';', 1)[0]?.trim() ?? '';
}

export function isTextLike(mimeType: string | undefined, fileName: string | undefined): boolean {
  if (TEXT_EXTENSIONS.has(extensionOf(fileName))) return true;
  const mime = normalizeMime(mimeType);
  if (!mime) return false;
  if (mime.startsWith('text/')) return true;
  return TEXT_MIMES.has(mime);
}

export function isUploadable(mimeType: string | undefined, fileName: string | undefined): boolean {
  const mime = normalizeMime(mimeType);
  if (mime.startsWith('image/')) return true;
  if (UPLOADABLE_MIMES.has(mime)) return true;
  return UPLOADABLE_EXTENSIONS.has(extensionOf(fileName));
}

export const ATTACHMENT_ACCEPT = [
  'image/*',
  'text/plain',
  ...[...UPLOADABLE_EXTENSIONS].sort().map((ext) => `.${ext}`),
].join(',');

const CHATGPT_ATTACHMENT_ACCEPT = [
  ATTACHMENT_ACCEPT,
  ...[...TEXT_EXTENSIONS].sort().map((ext) => `.${ext}`),
].join(',');

export function attachmentAcceptFor(provider: Provider): string {
  return provider === 'chatgpt' ? CHATGPT_ATTACHMENT_ACCEPT : ATTACHMENT_ACCEPT;
}
