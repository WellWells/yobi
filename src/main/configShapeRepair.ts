import type { StoredConfig } from './configTypes';

const OBJECT_FIELDS = ['telegram', 'line', 'discord', 'slack'] as const;

// Ciphertext every container must hold as a string: `decryptTokenChecked` calls `startsWith` on
// it during boot. The legacy single mail account (`smtp`) is read once by its migration, which
// tolerates any shape, so it is not repaired here.
const SECRET_FIELDS: Record<(typeof OBJECT_FIELDS)[number], readonly string[]> = {
  telegram: ['botTokenEncrypted', 'apiHashEncrypted'],
  line: ['channelAccessTokenEncrypted', 'channelSecretEncrypted'],
  discord: ['botTokenEncrypted'],
  slack: ['botTokenEncrypted', 'appTokenEncrypted'],
};
const BYOK_SECRET_FIELDS = ['apiKeyEncrypted'] as const;
const MAIL_SECRET_FIELDS = ['passwordEncrypted'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns a copy of `container` with each non-string secret emptied, or null when every secret
 * present is already a string. A number or object where ciphertext belongs holds no usable
 * secret, so emptying it loses nothing; the string secrets beside it are kept untouched.
 */
function repairSecrets(container: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | null {
  const bad = keys.filter((key) => container[key] !== undefined && typeof container[key] !== 'string');
  if (bad.length === 0) return null;
  const fixed = { ...container };
  for (const key of bad) fixed[key] = '';
  return fixed;
}

/** A list of secret-holding entries (BYOK keys, mail accounts): non-objects dropped, bad ciphertext emptied. */
function repairList(list: unknown, secretFields: readonly string[]): unknown[] | null {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const repaired: unknown[] = [];
  for (const entry of list) {
    if (!isPlainObject(entry)) {
      changed = true;
      continue;
    }
    const fixed = repairSecrets(entry, secretFields);
    if (fixed) changed = true;
    repaired.push(fixed ?? entry);
  }
  return changed ? repaired : null;
}

/**
 * Repairs the sensitive containers of a stored config that parsed but has the wrong shape.
 *
 * `openStoreWithRecovery` only catches parse failures, and electron-store merges defaults one
 * level deep, so a hand-edited `"telegram": null` or a non-string ciphertext would otherwise
 * crash boot. Only the bad field is replaced, so every other setting is kept.
 *
 * Returns the repaired store and the names of the fields it fixed, or null when nothing was wrong.
 */
export function repairStoredShape(
  stored: Record<string, unknown>,
  defaults: StoredConfig,
): { repaired: StoredConfig; fields: string[] } | null {
  const patch: Record<string, unknown> = {};
  const fields: string[] = [];

  for (const key of OBJECT_FIELDS) {
    const container = stored[key];
    if (!isPlainObject(container)) {
      patch[key] = structuredClone(defaults[key]);
      fields.push(key);
      continue;
    }
    const fixed = repairSecrets(container, SECRET_FIELDS[key]);
    if (!fixed) continue;
    patch[key] = fixed;
    fields.push(key);
  }

  const byok = repairList(stored.byokInstances, BYOK_SECRET_FIELDS);
  if (byok) {
    patch.byokInstances = byok;
    fields.push('byokInstances');
  }

  // Absent is fine (a config from before multiple mailboxes); the migration fills it in.
  const mail = stored.mailAccounts === undefined ? null : repairList(stored.mailAccounts, MAIL_SECRET_FIELDS);
  if (mail) {
    patch.mailAccounts = mail;
    fields.push('mailAccounts');
  }

  if (fields.length === 0) return null;
  return { repaired: { ...stored, ...patch } as StoredConfig, fields };
}
