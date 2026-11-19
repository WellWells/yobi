import type React from 'react';

/**
 * WCAG 2.2 SC 2.5.8: the smallest pointer target, in CSS px. Icon buttons
 * that sit next to other targets (inside an input, in a row of controls) are at least this big.
 */
export const MIN_TARGET_PX = 24;

/** Something that actually renders: not undefined, null or a boolean. */
type VisibleLabel = Exclude<React.ReactNode, undefined | null | boolean>;

/**
 * WCAG 2.2 SC 4.1.2: a form control must have an accessible name. Shared
 * controls (ToggleSwitch, SelectDropdown) take their props through this union so a call site
 * cannot compile without one of: a visible `label`, an `aria-label`, or an `aria-labelledby`
 * pointing at visible text (a setting row's title, say).
 */
export type AccessibleNameProps =
  | { label: VisibleLabel; 'aria-label'?: string; 'aria-labelledby'?: string }
  | { label?: undefined; 'aria-label': string; 'aria-labelledby'?: string }
  | { label?: undefined; 'aria-label'?: string; 'aria-labelledby': string };

/** A visible label when the caller has one, otherwise `fallback` as the aria-label. */
export function nameProps(label: string | undefined, fallback: string): AccessibleNameProps {
  return label ? { label } : { 'aria-label': fallback };
}

/** `Omit` that keeps the union above intact (plain `Omit` would merge it and drop the requirement). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
