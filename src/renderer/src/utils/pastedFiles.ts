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

  const files = Array.from(data.files ?? []);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file) continue;
    const duplicate = files.some((known) =>
      known.name === file.name && known.size === file.size && known.lastModified === file.lastModified);
    if (!duplicate) files.push(file);
  }
  return files;
}
