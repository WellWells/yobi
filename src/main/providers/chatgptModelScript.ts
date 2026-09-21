import type { ChatgptPickerSnapshot, ChatgptPickerTarget } from '../../shared/chatgptModels';

/*
 * chatgpt.com's model controls, measured 2026-09-18 (Free and Plus accounts, zh-TW UI):
 *
 * - Both live in the composer form as a `.__composer-pill` button. Labels are localized, so the two
 *   kinds are told apart by ARIA: the Free "Think" pill toggles (`aria-pressed`); the Plus effort
 *   pill opens a Radix menu (`aria-haspopup="menu"`, `aria-controls` → the menu while open).
 * - The Plus menu holds `[data-testid="composer-intelligence-picker-content"]`: a header row
 *   (`menuitem[aria-expanded]`) that flips `[data-view]` from "simple" to "advanced", a slider
 *   (`[data-model-reasoning-effort-slider] [role=slider]`, `aria-valuenow` = the step) moved with
 *   ArrowLeft / ArrowRight on its `menuitem`, and the versions as `menuitemradio` rows in
 *   `[data-testid="composer-model-picker-slider-advanced-view"]` (first line = the version's name).
 *   Picking a row returns to the slider; nothing closes the menu but the trigger.
 * - Step labels other than the current one are not in the DOM. The page's own
 *   `/backend-api/models` lists every version with its presets: `id` is the slider step, `title`
 *   the label shown for it. It needs the session's bearer token — without it the list is the
 *   signed-out one.
 * - A closed menu can linger with `data-state="closed"` while its exit animation waits (hidden
 *   pages never finish it), so "open" means the trigger says so and the menu is `data-state=open`.
 */
export const CHATGPT_PICKER_PILL_SELECTOR = 'form button.__composer-pill[aria-haspopup="menu"], form button.__composer-pill[aria-pressed]';

export type ChatgptPickerResult =
  | { ok: true; changed: boolean; snapshot: ChatgptPickerSnapshot }
  | { ok: false; reason: 'no-picker' | 'menu-did-not-open' | 'no-catalog' };

/** Reads the controls, switches to `target` when asked, and leaves the menu closed. `null` only reads. */
export function buildChatgptModelPickerScript(target: ChatgptPickerTarget | null): string {
  return `
(async function chatgptModelPicker() {
  var TARGET = ${JSON.stringify(target)};
  var CONTENT_SEL = '[data-testid="composer-intelligence-picker-content"]';
  var SLIDER_SEL = '[data-model-reasoning-effort-slider] [role="slider"]';
  var ADVANCED_SEL = '[data-testid="composer-model-picker-slider-advanced-view"]';
  var MODELS_URL = '/backend-api/models?history_and_training_disabled=false';

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  function slice(list) { return Array.prototype.slice.call(list || []); }
  async function waitUntil(test, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
      if (test()) return true;
      await sleep(30);
    }
    return !!test();
  }
  function lines(el) {
    return (el.innerText || el.textContent || '').split('\\n')
      .map(function(line) { return line.replace(/\\s+/g, ' ').trim(); })
      .filter(function(line) { return !!line; });
  }
  function composer() {
    var box = document.querySelector('#prompt-textarea');
    return (box && box.closest('form')) || document.querySelector('form[data-type="unified-composer"]');
  }
  function pills(attr) {
    var form = composer();
    return form ? slice(form.querySelectorAll('button.__composer-pill[' + attr + ']')) : [];
  }

  async function getJson(url, token) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 8000);
    try {
      var headers = token ? { authorization: 'Bearer ' + token } : {};
      var res = await fetch(url, { credentials: 'include', headers: headers, signal: controller.signal });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  // Versions don't change within a document, so one fetch serves every send on a kept page.
  async function loadVersions() {
    if (window.__yobiChatgptVersions) return window.__yobiChatgptVersions;
    var session = await getJson('/api/auth/session');
    var token = session && session.accessToken;
    if (!token) return null;
    var data = await getJson(MODELS_URL, token);
    if (!data || !Array.isArray(data.versions)) return null;
    var versions = data.versions.map(function(version) {
      var presets = (Array.isArray(version && version.intelligence_presets) ? version.intelligence_presets : [])
        .filter(function(p) { return p && typeof p.id === 'number' && p.lane && (!p.preset_type || p.preset_type === 'available'); })
        .map(function(p) {
          return {
            step: p.id,
            id: p.thinking_effort ? p.lane + ':' + p.thinking_effort : String(p.lane),
            label: String(p.title || p.selected_display_title || p.lane),
            shown: String(p.selected_display_title || p.title || ''),
          };
        });
      var name = version && (version.display_text_for_intelligence || version.display_text);
      return { id: String(version && version.id), label: String(name || ''), presets: presets };
    }).filter(function(version) { return version.label && version.presets.length > 0; });
    if (versions.length === 0) return null;
    window.__yobiChatgptVersions = versions;
    return versions;
  }

  // --- the Plus effort menu ---
  var trigger = null;
  function menu() {
    if (!trigger || trigger.getAttribute('aria-expanded') !== 'true') return null;
    var id = trigger.getAttribute('aria-controls');
    var byId = id ? document.getElementById(id) : null;
    var open = byId && byId.getAttribute('data-state') !== 'closed'
      ? byId
      : document.querySelector('[role="menu"][data-state="open"]');
    return open ? open.querySelector(CONTENT_SEL) : null;
  }
  function press(button) {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  }
  async function openMenu(button) {
    trigger = button;
    if (menu()) return true;
    press(button);
    return waitUntil(function() { return !!menu(); }, 3000);
  }
  async function closeMenu() {
    if (!trigger || trigger.getAttribute('aria-expanded') !== 'true') return;
    press(trigger);
    await waitUntil(function() { return trigger.getAttribute('aria-expanded') !== 'true'; }, 2000);
  }
  // A tool the user picked can add a menu pill of its own; only the one opening the picker counts.
  async function openPicker() {
    var candidates = pills('aria-haspopup="menu"');
    for (var i = 0; i < candidates.length; i++) {
      if (await openMenu(candidates[i])) return true;
      await closeMenu();
    }
    return false;
  }
  function slider() { var m = menu(); return m ? m.querySelector(SLIDER_SEL) : null; }
  function step() { var s = slider(); return s ? Number(s.getAttribute('aria-valuenow')) : NaN; }
  function view() { var m = menu(); var el = m && m.querySelector('[data-view]'); return el ? el.getAttribute('data-view') : ''; }
  function rows() { var m = menu(); var adv = m && m.querySelector(ADVANCED_SEL); return adv ? slice(adv.querySelectorAll('[role="menuitemradio"]')) : []; }
  function rowFor(version) {
    return rows().filter(function(row) { return lines(row)[0] === version.label; })[0] || null;
  }
  function currentLabel() {
    var m = menu();
    var el = m && m.querySelector('[data-max-effort]');
    return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null;
  }

  // Versions without a row are not on offer here; a picker without rows has one version.
  function offered(versions) {
    if (rows().length === 0) return versions.slice(0, 1).map(function(v) { return { version: v, row: null }; });
    return versions.map(function(v) { return { version: v, row: rowFor(v) }; })
      .filter(function(entry) { return !!entry.row; });
  }
  function readSlider(versions) {
    var list = offered(versions);
    var now = step();
    var label = currentLabel();
    return list.map(function(entry, index) {
      var selected = entry.row ? entry.row.getAttribute('aria-checked') === 'true' : index === 0;
      var text = entry.row ? lines(entry.row) : [];
      return {
        id: entry.version.id,
        label: entry.version.label,
        sublabel: text[1] || '',
        selected: selected,
        // The step is only trusted when the page names it the same way the list does.
        efforts: entry.version.presets.map(function(p) {
          var here = selected && p.step === now && (label === null || label === p.shown || label === p.label);
          return { id: p.id, label: p.label, sublabel: '', selected: here };
        }),
      };
    });
  }
  async function pickVersion(version) {
    var row = rowFor(version);
    var open = menu();
    if (!open || !row || row.getAttribute('aria-checked') === 'true') return false;
    var header = open.querySelector('[role="menuitem"][aria-expanded]');
    if (header && view() !== 'advanced') {
      header.click();
      await waitUntil(function() { return view() === 'advanced'; }, 1500);
    }
    row = rowFor(version);
    if (!row) return false;
    row.click();
    await waitUntil(function() { var r = rowFor(version); return !!r && r.getAttribute('aria-checked') === 'true'; }, 2000);
    return true;
  }
  // One key press per step, never past the target, so a locked step is never landed on.
  async function moveTo(target) {
    for (var guard = 0; guard < 8 && step() !== target; guard++) {
      var s = slider();
      var item = s && s.closest('[role="menuitem"]');
      if (!item) return false;
      var before = step();
      var key = target > before ? 'ArrowRight' : 'ArrowLeft';
      item.focus();
      item.dispatchEvent(new KeyboardEvent('keydown', { key: key, code: key, bubbles: true, cancelable: true }));
      if (!(await waitUntil(function() { return step() !== before; }, 1000))) return false;
    }
    return step() === target;
  }

  async function applyAndRead(versions) {
    var changed = false;
    if (TARGET && TARGET.modelId) {
      var wanted = versions.filter(function(v) { return v.id === TARGET.modelId; })[0];
      if (wanted && (await pickVersion(wanted))) changed = true;
    }
    if (TARGET && TARGET.effort) {
      var current = readSlider(versions).filter(function(m) { return m.selected; })[0];
      var version = current && versions.filter(function(v) { return v.id === current.id; })[0];
      var preset = version && version.presets.filter(function(p) { return p.id === TARGET.effort; })[0];
      if (preset && step() !== preset.step) {
        await moveTo(preset.step);
        changed = true;
      }
    }
    return { ok: true, changed: changed, snapshot: { models: readSlider(versions), thinking: null } };
  }
  // The menu is modal: left open it would hold focus and the prompt could not be typed, so it is
  // closed on every way out, a throw included.
  async function runSlider() {
    if (!(await openPicker())) return { ok: false, reason: 'menu-did-not-open' };
    try {
      var versions = await loadVersions();
      return versions ? await applyAndRead(versions) : { ok: false, reason: 'no-catalog' };
    } finally {
      await closeMenu();
    }
  }

  // --- the Free toggle ---
  async function runToggle(toggle) {
    var changed = false;
    var on = function() { return toggle.getAttribute('aria-pressed') === 'true'; };
    if (TARGET && TARGET.thinking !== null && on() !== TARGET.thinking) {
      toggle.click();
      changed = true;
      await waitUntil(function() { return on() === TARGET.thinking; }, 1500);
    }
    var text = lines(toggle);
    return { ok: true, changed: changed, snapshot: { models: [], thinking: { label: text[0] || '', sublabel: '', selected: on() } } };
  }

  // A page that showed no control once will not grow one; pay the wait once per document.
  function found() { return pills('aria-haspopup="menu"').length > 0 || pills('aria-pressed').length > 0; }
  if (!found() && window.__yobiChatgptNoPicker) return { ok: false, reason: 'no-picker' };
  if (!(await waitUntil(found, 2000))) {
    window.__yobiChatgptNoPicker = true;
    return { ok: false, reason: 'no-picker' };
  }
  // More than one toggle means the page grew something new; flipping the wrong one would change
  // an unrelated setting, so none is touched.
  var toggles = pills('aria-pressed');
  if (pills('aria-haspopup="menu"').length > 0) {
    var slid = await runSlider();
    if (slid.ok || toggles.length !== 1) return slid;
  }
  if (toggles.length !== 1) return { ok: false, reason: 'no-picker' };
  return runToggle(toggles[0]);
})()`;
}
