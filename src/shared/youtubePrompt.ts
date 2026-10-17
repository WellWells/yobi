/**
 * A custom template without `{{url}}` or `{{transcript}}` would ask for a summary of nothing, so the
 * missing slots go after the user's text. The built-in templates carry both and pass through as is.
 */
export function withVideoSlots(template: string): string {
  const missing = [
    template.includes('{{url}}') ? '' : '{{url}}',
    template.includes('{{transcript}}') ? '' : '---\n{{transcript}}\n---',
  ].filter(Boolean);
  return missing.length ? [template.trimEnd(), ...missing].filter(Boolean).join('\n\n') : template;
}
