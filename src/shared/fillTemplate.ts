const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/**
 * Fills every `{{name}}` placeholder in a language-file template, in one pass. Values go in
 * literally: a replacement string would read `$&`, `` $` ``, `$'` and `$$` in a user's chat or
 * flow name as patterns, and a value containing `{{other}}` is not filled again. Names not in
 * `vars` stay as written.
 */
export function fillTemplate(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined;
    return value === undefined ? match : String(value);
  });
}
