import { GEMINI_CATALOG_REV } from '../../shared/geminiModels';
import type { GeminiPickerSnapshot, GeminiPickerTarget } from '../../shared/geminiModels';

/*
 * Gemini's model picker, matched by attributes only (visible text is localized). The thinking
 * switch is the one row without `data-mode-id`; the signed-out sign-in row also lacks it and is
 * never clicked, since clicking it leaves the page.
 */
export const GEMINI_MODE_BUTTON_SELECTOR = '[data-test-id="bard-mode-menu-button"]';
export const GEMINI_MODE_MENU_SELECTOR = '[data-test-id="gem-mode-menu"]';
export const GEMINI_SIGN_IN_ROW_SELECTOR = '[data-test-id="mode-picker-sign-in-button"]';

export type GeminiPickerResult =
  | { ok: true; changed: boolean; snapshot: GeminiPickerSnapshot }
  | { ok: false; reason: 'no-picker' | 'menu-did-not-open' };

/**
 * A row for a model the account's plan does not include ("4 Carbon" on a Pro account,
 * `data-mode-id="upsell_MODE_CATEGORY_ULTRA"`, not marked disabled). It cannot be chosen — clicking
 * it only advertises the upgrade — so it is neither listed nor clicked.
 */
const UPSELL_MODE_PREFIX = 'upsell_';

export function isGeminiUpsellModeId(id: string): boolean {
  return id.startsWith(UPSELL_MODE_PREFIX);
}

const VERSION_LED = /^\d+(?:\.\d+)*\s/;

/**
 * Puts the model name in `label`. Which of a row's two lines holds it is not fixed: the localized
 * purpose ("quick answers") can be the first line and "3.5 Flash-Lite" the second. The name is the line that starts with a version number; the other is localized text.
 * When that does not single one out, the page's order stands. Applied to fresh reads and to the
 * cached list alike.
 */
export function withModelNameFirst<T extends { label: string; sublabel: string }>(row: T): T {
  if (VERSION_LED.test(row.label) || !VERSION_LED.test(row.sublabel)) return row;
  return { ...row, label: row.sublabel, sublabel: row.label };
}

interface GeminiRowLines {
  id: string;
  label: string;
  sublabel: string;
}

/**
 * Once the account's quota runs out, Gemini replaces a row's model line with the reset time
 * ("usage resets on Nov 15, 6:21 PM"), so neither line names the model and the purpose would be
 * kept as the name. Such a row keeps the name last read for the same id, with the purpose under
 * it; with no earlier name, the page's lines stand.
 *
 * The id alone does not make it the same row: the page can turn a model's row into one that names
 * no model ("Auto") and keep the id. The name is carried only while the purpose line is still the
 * one stored with it.
 */
function withKnownModelName<T extends GeminiRowLines>(row: T, known: readonly GeminiRowLines[]): T {
  if (hasModelName(row)) return row;
  const earlier = known.find((m) => m.id === row.id);
  if (!earlier || !VERSION_LED.test(earlier.label) || earlier.sublabel !== row.label) return row;
  return { ...row, label: earlier.label, sublabel: earlier.sublabel };
}

function hasModelName(row: GeminiRowLines): boolean {
  return VERSION_LED.test(row.label) || VERSION_LED.test(row.sublabel);
}

interface StoredGeminiNames {
  models: readonly GeminiRowLines[];
  rev?: number;
}

/**
 * Whether a stored list can be shown without reading the page again. Two things make it due:
 * it was stored under an earlier naming rule (a name may sit on the wrong row, and the list looks
 * healthy), or rows without a model name share their second line — the menu of an account out of
 * quota, where one reset time replaces several model names. A single row without a model name is
 * ordinary ("Auto").
 */
export function trustedGeminiCatalog<T extends StoredGeminiNames>(catalog: T | null): T | null {
  if (!catalog || catalog.rev !== GEMINI_CATALOG_REV) return null;
  const secondLines = catalog.models.filter((m) => !hasModelName(m)).map((m) => m.sublabel);
  return new Set(secondLines).size === secondLines.length ? catalog : null;
}

/**
 * The script reports the page's lines as they are; this is what the rest of the app reads.
 * `stored` is the last stored list, for rows that show no model name this time; names in a list
 * stored under an earlier rule are not used.
 */
export function namedGeminiPickerResult(
  result: GeminiPickerResult,
  stored: StoredGeminiNames | null = null,
): GeminiPickerResult {
  if (!result.ok) return result;
  const known = stored?.rev === GEMINI_CATALOG_REV ? stored.models : [];
  const models = result.snapshot.models.map((row) => withKnownModelName(withModelNameFirst(row), known));
  return { ...result, snapshot: { ...result.snapshot, models } };
}

/**
 * Opens the picker, reads it, switches it to `target` when asked, and closes it again.
 * With `target` null (or all-null) it only reads.
 */
export function buildGeminiModelPickerScript(target: GeminiPickerTarget | null): string {
  return `
(async function geminiModelPicker() {
  var BUTTON_SEL = ${JSON.stringify(GEMINI_MODE_BUTTON_SELECTOR)};
  var MENU_SEL = ${JSON.stringify(GEMINI_MODE_MENU_SELECTOR)};
  var SIGN_IN_SEL = ${JSON.stringify(GEMINI_SIGN_IN_ROW_SELECTOR)};
  var UPSELL_PREFIX = ${JSON.stringify(UPSELL_MODE_PREFIX)};
  var TARGET = ${JSON.stringify(target)};

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function button() { return document.querySelector(BUTTON_SEL); }
  function menu() { return document.querySelector(MENU_SEL); }
  async function waitUntil(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await sleep(50);
    }
    return !!test();
  }
  async function openMenu() {
    if (menu()) return true;
    var trigger = button();
    if (!trigger) return false;
    trigger.click();
    return waitUntil(function() { return !!menu(); }, 3000);
  }
  async function closeMenu() {
    if (!menu()) return;
    var trigger = button();
    if (trigger) trigger.click();
    await waitUntil(function() { return !menu(); }, 2000);
  }
  function textOf(row, selector) {
    var node = row.querySelector(selector);
    return node ? (node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  }
  function rows() {
    var open = menu();
    return open ? Array.prototype.slice.call(open.querySelectorAll('gem-menu-item')) : [];
  }
  function modelRows() {
    // An upsell row has a mode id too, but the plan does not include it.
    return rows().filter(function(row) {
      var id = row.getAttribute('data-mode-id');
      return id !== null && id.indexOf(UPSELL_PREFIX) !== 0;
    });
  }
  function locked(row) { return row.getAttribute('aria-disabled') === 'true'; }
  function thinkingRow() {
    var others = rows().filter(function(row) { return !row.hasAttribute('data-mode-id') && !row.matches(SIGN_IN_SEL); });
    return others.length === 1 ? others[0] : null;
  }
  function read() {
    var switchRow = thinkingRow();
    return {
      models: modelRows().map(function(row) {
        return {
          id: row.getAttribute('data-mode-id'),
          label: textOf(row, '.label'),
          sublabel: textOf(row, '.sublabel'),
          selected: row.classList.contains('selected')
        };
      }),
      thinking: switchRow ? {
        label: textOf(switchRow, '.label'),
        sublabel: textOf(switchRow, '.sublabel'),
        selected: switchRow.classList.contains('selected')
      } : null,
      // The sign-in row need not be a gem-menu-item, so look through the whole menu.
      signedIn: modelRows().length === 0 ? null : !menu().querySelector(SIGN_IN_SEL)
    };
  }
  async function clickAndReopen(row) {
    row.click();
    await waitUntil(function() { return !menu(); }, 2000);
    return openMenu();
  }

  // Right after a fresh load the composer can be ready a beat before the picker renders. A page
  // that showed none once will not grow one, so the wait is paid once per document, not per send:
  // an /agent run calls this every turn.
  if (!button() && window.__yobiGeminiNoPicker) return { ok: false, reason: 'no-picker' };
  if (!(await waitUntil(function() { return !!button(); }, 2000))) {
    window.__yobiGeminiNoPicker = true;
    return { ok: false, reason: 'no-picker' };
  }
  if (!(await openMenu())) return { ok: false, reason: 'menu-did-not-open' };

  var changed = false;
  if (TARGET && TARGET.modelId) {
    var wanted = modelRows().filter(function(row) { return row.getAttribute('data-mode-id') === TARGET.modelId; })[0];
    // A locked model (signed out) cannot be chosen; clicking it only spends the menu.
    if (wanted && !locked(wanted) && !wanted.classList.contains('selected')) {
      changed = true;
      if (!(await clickAndReopen(wanted))) return { ok: false, reason: 'menu-did-not-open' };
    }
  }
  if (TARGET && TARGET.thinking !== null) {
    var switchRow = thinkingRow();
    if (switchRow && switchRow.classList.contains('selected') !== TARGET.thinking) {
      changed = true;
      if (!(await clickAndReopen(switchRow))) return { ok: false, reason: 'menu-did-not-open' };
    }
  }

  var snapshot = read();
  await closeMenu();
  return { ok: true, changed: changed, snapshot: snapshot };
})()`;
}
