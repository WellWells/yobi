/**
 * How long a step without a timeout of its own may run (the JavaScript step among them). Kept here
 * so the runner (`flow/runtime.ts`) and the editor's hint read the same number.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 60_000;
