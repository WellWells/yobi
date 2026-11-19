import { createContext, use } from 'react';

/**
 * The id of the visible label a `SettingField` draws above its control. The shared text fields
 * (AppTextInput, AppTextarea, AppNumberInput, AppPasswordInput) read it and point `aria-labelledby`
 * at it, so the label names the field (WCAG 1.3.1, 4.1.2) instead of the field having no name or
 * only its placeholder.
 */
export const FieldLabelContext = createContext<string | undefined>(undefined);

interface NamingProps {
  label?: unknown;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** `aria-labelledby` for a field that has no name of its own; a field that names itself keeps it. */
export function fieldNameProps(labelId: string | undefined, props: NamingProps): { 'aria-labelledby'?: string } {
  if (!labelId) return {};
  if (props.label != null && props.label !== '') return {};
  if (props['aria-label'] || props['aria-labelledby']) return {};
  return { 'aria-labelledby': labelId };
}

export function useFieldName(props: NamingProps): { 'aria-labelledby'?: string } {
  return fieldNameProps(use(FieldLabelContext), props);
}
