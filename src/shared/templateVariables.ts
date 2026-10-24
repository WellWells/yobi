/**
 * The `{{name}}` references in a flow template, each once, trimmed — read exactly as the flow
 * interpolator reads them at run time, so a check made before the run sees what the run will fill.
 */
export function extractTemplateVariables(template: string): string[] {
  const vars = new Set<string>();
  const matches = template.matchAll(/\{\{([^}]+)\}\}/g);
  for (const match of matches) {
    const varName = match[1]?.trim();
    if (varName) vars.add(varName);
  }
  return [...vars];
}
