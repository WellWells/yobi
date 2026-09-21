import type { ClaudePickerSnapshot, ClaudePickerTarget } from '../../shared/claudeModels';

/*
 * claude.ai's model picker, measured 2026-09-18 (Free account, English UI):
 *
 * - Trigger `[data-testid="model-selector-dropdown"]` opens `[role="menu"][data-cds="ModelSelector"]`.
 *   Clicking the trigger again closes it, submenus included.
 * - Model rows carry `data-model-id`. A model this account may pick is `role="menuitemradio"` with
 *   `aria-checked`; a locked one (Opus and Fable on Free, with an "Upgrade" badge) is a plain
 *   `role="menuitem"`, and is skipped. Some selectable models live in a "More models" submenu.
 * - Two submenu triggers, `[role="menuitem"][aria-haspopup="menu"]`, each pointing at its menu via
 *   `aria-controls`. Their labels are localized, so they are told apart by what they open: effort
 *   rows (`data-effort-id`) and the thinking switch (the one `menuitemcheckbox`), or model rows.
 *   Haiku 4.5 has only the switch; a model with neither has no options submenu at all.
 * - Picking a model or an effort level closes the whole menu; flipping thinking leaves it open.
 * - Submenus open on hover (~30 ms), so the script sends the pointer sequence a mouse would.
 */
export const CLAUDE_MODEL_TRIGGER_SELECTOR = '[data-testid="model-selector-dropdown"]';
export const CLAUDE_MODEL_MENU_SELECTOR = '[role="menu"][data-cds="ModelSelector"]';

export type ClaudePickerResult =
  | { ok: true; changed: boolean; snapshot: ClaudePickerSnapshot }
  | { ok: false; reason: 'no-picker' | 'menu-did-not-open' };

/** Opens the picker, reads it, switches to `target` when asked, and closes it. `null` only reads. */
export function buildClaudeModelPickerScript(target: ClaudePickerTarget | null): string {
  return `
(async function claudeModelPicker() {
  var TRIGGER_SEL = ${JSON.stringify(CLAUDE_MODEL_TRIGGER_SELECTOR)};
  var MENU_SEL = ${JSON.stringify(CLAUDE_MODEL_MENU_SELECTOR)};
  var TARGET = ${JSON.stringify(target)};

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function slice(list) { return Array.prototype.slice.call(list || []); }
  function trigger() { return document.querySelector(TRIGGER_SEL); }
  function root() { return document.querySelector(MENU_SEL); }
  async function waitUntil(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await sleep(30);
    }
    return !!test();
  }
  async function openRoot() {
    if (root()) return true;
    var button = trigger();
    if (!button) return false;
    button.click();
    return waitUntil(function() { return !!root(); }, 3000);
  }
  async function closeAll() {
    if (!root()) return;
    var button = trigger();
    if (button) button.click();
    await waitUntil(function() { return !root(); }, 2000);
  }
  function lines(row) {
    return (row.innerText || row.textContent || '').split('\\n')
      .map(function(line) { return line.replace(/\\s+/g, ' ').trim(); })
      .filter(function(line) { return !!line; });
  }
  function describe(row, id) {
    var text = lines(row);
    return { id: id, label: text[0] || id, sublabel: text[1] || '', selected: row.getAttribute('aria-checked') === 'true' };
  }
  function submenuTriggers() {
    var open = root();
    return open ? slice(open.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]')) : [];
  }
  function submenuOf(item) {
    var id = item.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }
  function hover(item) {
    var box = item.getBoundingClientRect();
    var at = { bubbles: true, clientX: box.left + 10, clientY: box.top + box.height / 2 };
    ['pointerover', 'pointerenter', 'pointermove'].forEach(function(type) {
      item.dispatchEvent(typeof PointerEvent === 'function'
        ? new PointerEvent(type, Object.assign({ pointerType: 'mouse' }, at))
        : new MouseEvent(type, at));
    });
    item.dispatchEvent(new MouseEvent('mouseover', at));
    item.dispatchEvent(new MouseEvent('mousemove', at));
    item.click();
  }
  async function openSubmenu(item) {
    if (item.getAttribute('aria-expanded') !== 'true' || !submenuOf(item)) hover(item);
    var opened = await waitUntil(function() { return item.getAttribute('aria-expanded') === 'true' && !!submenuOf(item); }, 2000);
    return opened ? submenuOf(item) : null;
  }
  function isOptionsMenu(menu) {
    return !!menu.querySelector('[data-effort-id], [role="menuitemcheckbox"]');
  }
  function selectableModels(menu) {
    return slice(menu.querySelectorAll('[data-model-id][role="menuitemradio"]'));
  }

  // Opening one submenu unmounts the other, so each is handled by \`visit\` while it is open; a
  // row kept from an earlier submenu is detached and can neither be read nor clicked.
  // \`visit\` returning true stops the walk.
  async function eachSubmenu(visit) {
    var triggers = submenuTriggers();
    var allOpened = true;
    for (var i = 0; i < triggers.length; i++) {
      var menu = await openSubmenu(submenuTriggers()[i] || triggers[i]);
      if (!menu) { allOpened = false; continue; }
      if (visit(menu) === true) break;
    }
    return allOpened;
  }
  function describeModels(menu) {
    return selectableModels(menu).map(function(row) { return describe(row, row.getAttribute('data-model-id')); });
  }
  function modelRow(menu, id) {
    return selectableModels(menu).filter(function(row) { return row.getAttribute('data-model-id') === id; })[0] || null;
  }
  // True when it clicked; the page closes the whole menu on a model pick.
  async function pickModel(id) {
    var open = root();
    var direct = open ? modelRow(open, id) : null;
    if (direct) {
      if (direct.getAttribute('aria-checked') === 'true') return false;
      direct.click();
      return true;
    }
    var clicked = false;
    await eachSubmenu(function(menu) {
      if (isOptionsMenu(menu)) return false;
      var row = modelRow(menu, id);
      if (!row) return false;
      if (row.getAttribute('aria-checked') !== 'true') {
        row.click();
        clicked = true;
      }
      return true;
    });
    return clicked;
  }
  async function openOptions() {
    var triggers = submenuTriggers();
    for (var i = 0; i < triggers.length; i++) {
      var menu = await openSubmenu(triggers[i]);
      if (menu && isOptionsMenu(menu)) return menu;
    }
    return null;
  }
  function readOptions(menu) {
    var efforts = slice(menu.querySelectorAll('[data-effort-id]')).map(function(row) {
      return describe(row, row.getAttribute('data-effort-id'));
    });
    // More than one switch means the page grew something new; flipping the wrong one would change
    // an unrelated setting on the user's account, so none is reported.
    var switches = slice(menu.querySelectorAll('[role="menuitemcheckbox"]'));
    var thinking = null;
    if (switches.length === 1) {
      var text = lines(switches[0]);
      thinking = { label: text[0] || '', sublabel: text[1] || '', selected: switches[0].getAttribute('aria-checked') === 'true' };
    }
    return { efforts: efforts, thinking: thinking };
  }
  // Options are "none" only when every submenu opened and none held them; a submenu that refused
  // to open leaves them unknown rather than guessed.
  async function read() {
    var open = root();
    var models = open ? describeModels(open) : [];
    var options = null;
    var allOpened = await eachSubmenu(function(menu) {
      if (isOptionsMenu(menu)) options = readOptions(menu);
      else models = models.concat(describeModels(menu));
      return false;
    });
    if (!options && allOpened) options = { efforts: [], thinking: null };
    // A new chat lists its featured models in the main menu; a conversation shows only its own.
    var pageOrdered = !!open && selectableModels(open).length > 1;
    return { models: models, options: options, pageOrdered: pageOrdered };
  }
  async function reopen() {
    await waitUntil(function() { return !root(); }, 2000);
    return openRoot();
  }

  // A page that showed no picker once will not grow one; pay the wait once per document.
  if (!trigger() && window.__yobiClaudeNoPicker) return { ok: false, reason: 'no-picker' };
  if (!(await waitUntil(function() { return !!trigger(); }, 2000))) {
    window.__yobiClaudeNoPicker = true;
    return { ok: false, reason: 'no-picker' };
  }
  if (!(await openRoot())) return { ok: false, reason: 'menu-did-not-open' };

  var changed = false;
  if (TARGET && TARGET.modelId && (await pickModel(TARGET.modelId))) {
    changed = true;
    if (!(await reopen())) return { ok: false, reason: 'menu-did-not-open' };
  }

  if (TARGET && (TARGET.effort || TARGET.thinking !== null)) {
    var menu = await openOptions();
    if (menu && TARGET.effort) {
      var level = slice(menu.querySelectorAll('[data-effort-id]')).filter(function(row) {
        return row.getAttribute('data-effort-id') === TARGET.effort;
      })[0];
      if (level && level.getAttribute('aria-checked') !== 'true') {
        level.click();
        changed = true;
        if (!(await reopen())) return { ok: false, reason: 'menu-did-not-open' };
        menu = await openOptions();
      }
    }
    if (menu && TARGET.thinking !== null) {
      var toggles = slice(menu.querySelectorAll('[role="menuitemcheckbox"]'));
      if (toggles.length === 1 && (toggles[0].getAttribute('aria-checked') === 'true') !== TARGET.thinking) {
        toggles[0].click();
        changed = true;
        await waitUntil(function() { return (toggles[0].getAttribute('aria-checked') === 'true') === TARGET.thinking; }, 1500);
      }
    }
  }

  var snapshot = await read();
  await closeAll();
  return { ok: true, changed: changed, snapshot: snapshot };
})()`;
}
