import type { ClaudePickerSnapshot, ClaudePickerTarget } from '../../shared/claudeModels';

/*
 * claude.ai's model picker. Rows are matched by attributes and roles only; labels are localized.
 * `/api/account` is a second source for model names, never a replacement for the menu.
 */
export const CLAUDE_MODEL_TRIGGER_SELECTOR = '[data-testid="model-selector-dropdown"]';
export const CLAUDE_MODEL_MENU_SELECTOR = '[role="menu"][data-cds="ModelSelector"]';
export const CLAUDE_CUSTOM_TOGGLE_SELECTOR = '[data-testid="cw-ms-toggle"]';

export type ClaudePickerResult =
  | { ok: true; changed: boolean; snapshot: ClaudePickerSnapshot }
  | { ok: false; reason: 'no-picker' | 'menu-did-not-open' };

/**
 * Browser-side: the official model list from the page's account data, or `null`. Kept apart from
 * the menu walk so a change in one cannot break the other.
 */
const READ_OFFICIAL_SOURCE = `
  async function readOfficial() {
    var abort = typeof AbortController === 'function' ? new AbortController() : null;
    // Covers the body too: a response whose headers arrive and whose body stalls is aborted.
    var timer = setTimeout(function() { if (abort) abort.abort(); }, 5000);
    try {
      var res = await fetch('/api/account', { credentials: 'include', signal: abort ? abort.signal : undefined });
      if (!res.ok) return null;
      var data = await res.json();
      var org = (document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/) || [])[1] || '';
      var found = [];
      (function walk(value, depth, owner) {
        if (!value || typeof value !== 'object' || depth > 8) return;
        if (Array.isArray(value)) {
          var entries = value.filter(function(item) {
            return item && typeof item.model === 'string' && item.model.indexOf('claude-') === 0 && typeof item.name === 'string';
          });
          if (entries.length > 0 && entries.length === value.length) { found.push({ list: entries, owner: owner }); return; }
          value.forEach(function(item) { walk(item, depth + 1, owner); });
          return;
        }
        var nextOwner = typeof value.uuid === 'string' ? value.uuid : owner;
        Object.keys(value).forEach(function(key) { walk(value[key], depth + 1, nextOwner); });
      })(data, 0, '');
      var mine = found.filter(function(hit) { return org && hit.owner === org; })[0] || found[0];
      if (!mine) return null;
      return mine.list
        .filter(function(item) { return !item.inactive; })
        .map(function(item) { return { id: item.model, name: item.name, legacy: !!item.overflow }; });
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
`;

/** Opens the picker, reads it, switches to `target` when asked, and closes it. `null` only reads. */
export function buildClaudeModelPickerScript(target: ClaudePickerTarget | null): string {
  return `
(async function claudeModelPicker() {
  var TRIGGER_SEL = ${JSON.stringify(CLAUDE_MODEL_TRIGGER_SELECTOR)};
  var MENU_SEL = ${JSON.stringify(CLAUDE_MODEL_MENU_SELECTOR)};
  var CUSTOM_SEL = ${JSON.stringify(CLAUDE_CUSTOM_TOGGLE_SELECTOR)};
  var TARGET = ${JSON.stringify(target)};
${READ_OFFICIAL_SOURCE}
  // Started first and awaited last: it costs the menu walk nothing.
  var official = readOfficial();

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
  function lockedIds(menu) {
    return slice(menu.querySelectorAll('[data-model-id]:not([role="menuitemradio"])')).map(function(row) {
      return row.getAttribute('data-model-id');
    });
  }

  // The button that revealed the model rows, so a read that changed nothing can put it back.
  var revealedBy = null;
  // Model rows may sit behind a view switch: press the known toggle, else the menu's only pressable
  // button; never one of several, and never left pressed when it revealed nothing.
  async function revealModels() {
    var open = root();
    if (!open || open.querySelector('[data-model-id]')) return;
    // The known toggle already pressed with no rows is a page change to report, not a reason to
    // try some other button.
    if (open.querySelector(CUSTOM_SEL + '[aria-pressed="true"]')) return;
    var known = slice(open.querySelectorAll(CUSTOM_SEL + '[aria-pressed="false"]'));
    var pressable = known.length > 0
      ? known
      : slice(open.querySelectorAll('button[aria-pressed="false"]:not([disabled]):not([aria-disabled="true"])'));
    if (pressable.length !== 1) return;
    var button = pressable[0];
    button.click();
    var shown = await waitUntil(function() { return !!(root() && root().querySelector('[data-model-id]')); }, 1500);
    if (shown) { revealedBy = button; return; }
    if (button.isConnected && button.getAttribute('aria-pressed') === 'true') button.click();
  }
  async function hideModelsAgain() {
    var open = root();
    if (!revealedBy || !open) return;
    var button = revealedBy.isConnected ? revealedBy : open.querySelector(CUSTOM_SEL);
    if (button && button.getAttribute('aria-pressed') === 'true') {
      button.click();
      await sleep(150);
    }
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
  function describeModels(menu, more) {
    return selectableModels(menu).map(function(row) {
      var entry = describe(row, row.getAttribute('data-model-id'));
      if (more) entry.more = true;
      return entry;
    });
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
    var models = open ? describeModels(open, false) : [];
    var locked = open ? lockedIds(open) : [];
    var options = null;
    var allOpened = await eachSubmenu(function(menu) {
      if (isOptionsMenu(menu)) options = readOptions(menu);
      else {
        models = models.concat(describeModels(menu, true));
        locked = locked.concat(lockedIds(menu));
      }
      return false;
    });
    if (!options && allOpened) options = { efforts: [], thinking: null };
    // A new chat lists its featured models in the main menu; a conversation shows only its own.
    var pageOrdered = !!open && selectableModels(open).length > 1;
    return { models: models, options: options, pageOrdered: pageOrdered, locked: locked };
  }
  async function reopen() {
    await waitUntil(function() { return !root(); }, 2000);
    if (!(await openRoot())) return false;
    await revealModels();
    return true;
  }

  // A page that showed no picker once will not grow one; pay the wait once per document.
  if (!trigger() && window.__yobiClaudeNoPicker) return { ok: false, reason: 'no-picker' };
  if (!(await waitUntil(function() { return !!trigger(); }, 2000))) {
    window.__yobiClaudeNoPicker = true;
    return { ok: false, reason: 'no-picker' };
  }
  if (!(await openRoot())) return { ok: false, reason: 'menu-did-not-open' };
  await revealModels();

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
  // Only a pure read puts the view back; a switch made in the custom view stays where it was made.
  if (!changed) await hideModelsAgain();
  await closeAll();
  // A second source must never cost the menu read: whatever has not arrived by now is skipped.
  snapshot.official = await Promise.race([official, sleep(3000).then(function() { return null; })]);
  return { ok: true, changed: changed, snapshot: snapshot };
})()`;
}
