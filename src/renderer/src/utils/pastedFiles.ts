function hasTextFlavour(data: DataTransfer): boolean {
  return Array.from(data.types ?? []).some((type) => type.startsWith('text/'));
}

export function pasteMayHoldSystemFile(data: DataTransfer | null): boolean {
  if (!data || hasTextFlavour(data)) return false;
  return collectPastedFiles(data).length === 0;
}

export function collectPastedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const types = Array.from(data.types ?? []);
  if (types.includes('text/plain')) return [];

  // `files` is the file items themselves, but a clipboard picture is a new File (stamped "now") on
  // every getAsFile(), so merging the two lists attached one screenshot twice. Items only fill in
  // when `files` came back empty.
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
