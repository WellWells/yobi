const THUMBNAIL_PX = 48;

export async function imageThumbnailDataUrl(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, {
      resizeHeight: THUMBNAIL_PX,
      resizeQuality: 'medium',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
