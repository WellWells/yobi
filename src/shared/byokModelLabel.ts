/**
 * How a BYOK model id reads on screen. The Gemini API names models `models/<id>`; the prefix is the
 * API's resource path, not part of the model's name. Display only: stored ids and request bodies
 * keep exactly what the user saved.
 */
export function byokModelLabel(model: string): string {
  return model.trim().replace(/^models\//, '');
}
