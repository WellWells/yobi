/** `value` as a regular-expression source that matches the text itself, every metacharacter escaped. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
