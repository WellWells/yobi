const BRAND = 'Yobi';

const INFO_SCAN_BYTES = 2_048;

function replaceStringEntry(info: string, key: string, value: string): string | null {
  const match = new RegExp(`/${key}\\s*\\(([^()\\\\]*)\\)`).exec(info);
  if (!match) return null;
  const entry = `/${key} (${value})`;
  if (entry.length > match[0].length) return null;
  return info.slice(0, match.index) + entry.padEnd(match[0].length, ' ') + info.slice(match.index + match[0].length);
}

export function brandPdfMetadata(pdf: Buffer, brand: string = BRAND): Buffer {
  const head = pdf.subarray(0, INFO_SCAN_BYTES).toString('latin1');
  const infoEnd = head.indexOf('endobj');
  if (infoEnd < 0) return pdf;

  const original = head.slice(0, infoEnd);
  if (!original.includes('/Producer')) return pdf;

  let info = original;
  for (const key of ['Creator', 'Producer']) {
    info = replaceStringEntry(info, key, brand) ?? info;
  }
  if (info === original) return pdf;

  const patched = Buffer.from(pdf);
  patched.write(info, 0, infoEnd, 'latin1');
  return patched;
}
