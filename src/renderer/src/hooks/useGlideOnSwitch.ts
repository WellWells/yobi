import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const GLIDE_MS = 360;
const FADE_MS = 200;
// Decelerating: leaves quickly and settles gently, the way the providers' own composers drop.
const GLIDE_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

export type Glide = { kind: 'slide'; offset: number } | { kind: 'fade' } | null;

/**
 * Slide from `from` to `to`, or fade in place when the system asks for reduced motion (Windows
 * "Animation effects" off, the default over Remote Desktop), so it still doesn't jump.
 */
export function planGlide(switched: boolean, from: number | null, to: number, reducedMotion: boolean): Glide {
  if (!switched || from === null || Math.abs(from - to) <= 1) return null;
  return reducedMotion ? { kind: 'fade' } : { kind: 'slide', offset: from - to };
}

/**
 * Slides an element from its last resting spot to where the new layout puts it whenever
 * `layoutKey` changes, instead of letting it jump (FLIP; see `planGlide` for reduced motion). Positions are `offsetTop`, which ignores
 * transforms, so a reading taken mid-glide is still the resting spot. A ResizeObserver keeps that
 * spot current when the window, or the element itself, changes size between switches.
 */
export function useGlideOnSwitch(ref: RefObject<HTMLElement | null>, layoutKey: unknown): void {
  const restingTop = useRef<number | null>(null);
  const lastKey = useRef(layoutKey);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.offsetTop;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const glide = planGlide(lastKey.current !== layoutKey, restingTop.current, top, reduced);
    if (glide?.kind === 'slide') {
      el.animate(
        [{ transform: `translateY(${glide.offset}px)` }, { transform: 'translateY(0)' }],
        { duration: GLIDE_MS, easing: GLIDE_EASING },
      );
    } else if (glide?.kind === 'fade') {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    }
    lastKey.current = layoutKey;
    restingTop.current = top;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      restingTop.current = el.offsetTop;
    });
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => observer.disconnect();
  }, [ref]);
}
