/** The message of a thrown Error, or the thrown value as a string when it is not one. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
