/**
 * The JavaScript step's own names, shared by the runner (`execJs`) and the editor's hint so the
 * names a card lists are exactly the ones the code can use.
 */
export const JS_PARAM_NAMES = [
  'vars', 'JSON', 'Math', 'Date', 'console', 'fetch', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'Buffer', 'structuredClone', 'crypto',
] as const;

// A `const` named like a function parameter is a SyntaxError in the body, so context
// keys that collide with a parameter stay reachable only through `vars[...]`.
const JS_RESERVED = new Set<string>([
  ...JS_PARAM_NAMES,
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new',
  'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

/** Whether an output name reaches the code as a bare `const`; any other is only `vars["…"]`. */
export function isInjectableIdentifier(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && !JS_RESERVED.has(key);
}
