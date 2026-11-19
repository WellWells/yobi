import { PERPLEXITY_AUTO_MODEL_ID } from '../../shared/perplexityModels';
import type { PerplexityPickerSnapshot, PerplexityPickerTarget } from '../../shared/perplexityModels';
import { PPLX_COMPOSER_BOX_SELECTOR } from './perplexityReadScript';

/*
 * Perplexity's model menu, matched by structure only (its text follows the account's language).
 * The trigger is the one menu button inside the ask box; the menu is a Radix menu, which opens on
 * pointerdown and closes on Escape. A model the plan can use is a radio row, a locked one is a
 * plain row, so only radio rows are read or clicked. The model's name is the part the page marks
 * `translate="no"`.
 */
export const PERPLEXITY_MODEL_TRIGGER_SELECTOR = PPLX_COMPOSER_BOX_SELECTOR
  .split(', ')
  .map((box) => `${box} button[aria-haspopup="menu"]`)
  .join(', ');
const MENU_SELECTOR = '[role="menu"][data-radix-menu-content]';

export type PerplexityPickerResult =
  | { ok: true; changed: boolean; snapshot: PerplexityPickerSnapshot }
  | { ok: false; reason: 'no-picker' | 'menu-did-not-open' };

/**
 * Opens the menu, reads it, switches it to `target` when asked, and closes it again.
 * With `target` null (or its model null) it only reads.
 */
export function buildPerplexityModelPickerScript(target: PerplexityPickerTarget | null): string {
  return `
(async function perplexityModelPicker() {
  var TRIGGER_SEL = ${JSON.stringify(PERPLEXITY_MODEL_TRIGGER_SELECTOR)};
  var MENU_SEL = ${JSON.stringify(MENU_SELECTOR)};
  var AUTO_ID = ${JSON.stringify(PERPLEXITY_AUTO_MODEL_ID)};
  var TARGET = ${JSON.stringify(target)};

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  async function waitUntil(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await sleep(50);
    }
    return !!test();
  }
  // More than one menu button in the box means the box grew something new: guessing which one is
  // the model menu could open, and change, something else.
  function trigger() {
    var found = document.querySelectorAll(TRIGGER_SEL);
    return found.length === 1 ? found[0] : null;
  }
  function menu() { return document.querySelector(MENU_SEL); }
  async function openMenu() {
    if (menu()) return true;
    var button = trigger();
    if (!button) return false;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
    return waitUntil(function() { return !!menu(); }, 2500);
  }
  async function closeMenu() {
    for (var i = 0; i < 3 && menu(); i += 1) {
      var open = menu();
      open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await waitUntil(function() { return menu() !== open; }, 800);
    }
  }
  function nameOf(row) {
    var node = row.querySelector('[translate="no"]');
    return node ? (node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  }
  function hasSubmenu(row) { return row.getAttribute('aria-haspopup') === 'menu'; }
  function rows() {
    var open = menu();
    if (!open) return [];
    var autoTaken = false;
    return Array.prototype.slice.call(open.querySelectorAll('[role="menuitemradio"]')).map(function(row) {
      var name = nameOf(row);
      var id = name;
      // The page's own "choose for me" row is the first one that opens no submenu.
      if (!hasSubmenu(row) && !autoTaken) { autoTaken = true; id = AUTO_ID; }
      return { row: row, id: id, label: name, selected: row.getAttribute('aria-checked') === 'true' };
    }).filter(function(entry) { return !!entry.id && !!entry.label; });
  }
  function read() {
    return { models: rows().map(function(entry) { return { id: entry.id, label: entry.label, selected: entry.selected }; }) };
  }

  // A page that showed no model button once will not grow one, so the wait is paid once per
  // document, not on every send.
  if (!trigger() && window.__yobiPerplexityNoPicker) return { ok: false, reason: 'no-picker' };
  if (!(await waitUntil(function() { return !!trigger(); }, 2000))) {
    window.__yobiPerplexityNoPicker = true;
    return { ok: false, reason: 'no-picker' };
  }
  if (!(await openMenu())) return { ok: false, reason: 'menu-did-not-open' };
  await waitUntil(function() { return rows().length > 0; }, 800);

  var changed = false;
  if (TARGET && TARGET.modelId) {
    var wanted = rows().filter(function(entry) { return entry.id === TARGET.modelId; })[0];
    if (wanted && !wanted.selected) {
      changed = true;
      wanted.row.click();
      // Choosing closes the menu; it is opened again to read what the page really selected.
      await waitUntil(function() { return !menu(); }, 1500);
      if (!(await openMenu())) return { ok: false, reason: 'menu-did-not-open' };
      await waitUntil(function() { return rows().length > 0; }, 800);
    }
  }

  var snapshot = read();
  await closeMenu();
  return { ok: true, changed: changed, snapshot: snapshot };
})()`;
}
