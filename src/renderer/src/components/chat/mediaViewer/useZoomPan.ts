import { useState } from 'react';
import {
  clampOffset, fitScale, initialZoom, stepZoom, toggleZoom, zoomAt, zoomScale,
  type Point, type Size, type Zoom,
} from './viewerMath';

interface View { file: string; natural: Size | null; zoom: Zoom; offset: Point }

const ORIGIN: Point = { x: 0, y: 0 };

function fresh(file: string): View {
  return { file, natural: null, zoom: 'fit', offset: ORIGIN };
}

export interface ZoomPan {
  /** Size and pan on screen; null until the media has told its own size. */
  shown: Size | null;
  offset: Point;
  canPan: boolean;
  setNatural: (size: Size) => void;
  zoomBy: (direction: 1 | -1, anchor: Point) => void;
  toggle: () => void;
  panTo: (offset: Point) => void;
}

/** Zoom and pan of the item on screen; moving to another item starts it over. */
export function useZoomPan(file: string, room: Size): ZoomPan {
  const [stored, setStored] = useState<View>(() => fresh(file));
  const view = stored.file === file ? stored : fresh(file);

  const layout = (v: View, zoom: Zoom = v.zoom): { scale: number; shown: Size } | null => {
    if (!v.natural) return null;
    const scale = zoomScale(zoom, fitScale(v.natural, room));
    return { scale, shown: { w: v.natural.w * scale, h: v.natural.h * scale } };
  };
  const update = (change: (v: View) => View): void => {
    setStored((prev) => change(prev.file === file ? prev : fresh(file)));
  };

  const now = layout(view);
  const offset = now ? clampOffset(view.offset, now.shown, room) : ORIGIN;

  return {
    shown: now?.shown ?? null,
    offset,
    canPan: now !== null && (now.shown.w > room.w + 0.5 || now.shown.h > room.h + 0.5),
    setNatural: (natural) => update(() => ({ file, natural, zoom: initialZoom(natural, room), offset: ORIGIN })),
    zoomBy: (direction, anchor) => update((v) => {
      const from = layout(v);
      if (!from || !v.natural) return v;
      const zoom = stepZoom(v.zoom, fitScale(v.natural, room), direction);
      const to = layout(v, zoom)!;
      const start = clampOffset(v.offset, from.shown, room);
      return { ...v, zoom, offset: clampOffset(zoomAt(start, anchor, from.scale, to.scale), to.shown, room) };
    }),
    toggle: () => update((v) => ({ ...v, zoom: toggleZoom(v.zoom), offset: ORIGIN })),
    panTo: (next) => update((v) => {
      const at = layout(v);
      return at ? { ...v, offset: clampOffset(next, at.shown, room) } : v;
    }),
  };
}
