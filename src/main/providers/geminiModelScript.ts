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
 * Opens the picker, reads it, switches it to `target` when asked, and closes it again.
 * With `target` null (or all-null) it only reads.
 */
export function buildGeminiModelPickerScript(target: GeminiPickerTarget | null): string {
  return `
(async function geminiModelPicker() {
  var BUTTON_SEL = ${JSON.stringify(GEMINI_MODE_BUTTON_SELECTOR)};
  var MENU_SEL = ${JSON.stringify(GEMINI_MODE_MENU_SELECTOR)};
  var SIGN_IN_SEL = ${JSON.stringify(GEMINI_SIGN_IN_ROW_SELECTOR)};
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
    return rows().filter(function(row) { return row.hasAttribute('data-mode-id'); });
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
      } : null
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
