import { measureElement, observeElementRect } from '@tanstack/react-virtual';

/*
 * A virtual list whose scroll box is hidden (`display: none`) or not laid out yet reports a zero
 * height, and its rows measure 0. Taken at face value the virtualizer would drop every row, or
 * stack them all at offset 0 and draw the whole list. Both helpers keep the last real size
 * instead (a row with no size yet falls back to its estimate).
 */

export const observeRectKeepLast: typeof observeElementRect = (instance, cb) =>
  observeElementRect(instance, (rect) => {
    if (rect.height === 0) return;
    cb(rect);
  });

export const measureElementKeepLast: typeof measureElement = (element, entry, instance) => {
  const size = measureElement(element, entry, instance);
  if (size > 0) return size;
  const index = instance.indexFromElement(element);
  return instance.itemSizeCache.get(instance.options.getItemKey(index))
    ?? instance.options.estimateSize(index);
};
