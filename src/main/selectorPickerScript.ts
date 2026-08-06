import { PICKER_ALGO_SOURCE } from './selectorPickerAlgo';

export interface PickerStrings {
  banner: string;
  cancelHint: string;
  notAList: string;
  scope: string;
  rowCount: string;
  advanced: string;
  labelItem: string;
  labelTitle: string;
  labelLink: string;
  rowIsLink: string;
  noLink: string;
  more: string;
  confirm: string;
  cancel: string;
}

const PANEL_CSS = [
  'position:fixed;bottom:16px;right:16px;z-index:2147483647;width:440px;max-width:calc(100vw - 32px)',
  'background:#1a1b1e;color:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5)',
  'font:13px/1.5 system-ui,-apple-system,sans-serif;padding:14px;display:none',
].join(';');

/**
 * Interactive list picker injected into the target page.
 *
 * Hover-highlight and click stay live for the whole session so a wrong guess is
 * corrected by clicking somewhere else rather than reopening the window. The
 * panel's preview runs the same extraction the scraper will run, which is the
 * point of the whole thing: the user approves rows, not a CSS selector.
 */
export function buildPickerScript(strings: PickerStrings, timeoutMs: number): string {
  return `(function(){
    return new Promise(function(resolve){
      ${PICKER_ALGO_SOURCE}
      var S = ${JSON.stringify(strings)};
      var TIMEOUT_MS = ${JSON.stringify(timeoutMs)};

      var state = { levels: [], index: 0, item: '', title: '', link: '', manual: false, nodes: [] };

      function el(tag, css, text){
        var node = document.createElement(tag);
        if (css) node.style.cssText = css;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      var bar = el('div', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1a1b1e;color:#fff;font:600 14px/1.5 system-ui,-apple-system,sans-serif;padding:10px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.35);');
      bar.textContent = S.banner + '   ·   ' + S.cancelHint;
      document.documentElement.appendChild(bar);

      var hover = el('div', 'position:fixed;z-index:2147483645;pointer-events:none;border:2px solid #4c8dff;background:rgba(76,141,255,0.18);border-radius:2px;display:none;');
      document.documentElement.appendChild(hover);

      var marks = el('div', 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483644;pointer-events:none;');
      document.documentElement.appendChild(marks);

      var panel = el('div', ${JSON.stringify(PANEL_CSS)});

      var scopeRow = el('div', 'display:flex;align-items:center;gap:10px;margin-bottom:10px;');
      var scopeLabel = el('span', 'font-weight:600;white-space:nowrap;', S.scope);
      var slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.step = '1';
      slider.style.cssText = 'flex:1;accent-color:#4c8dff;';
      var countBadge = el('span', 'font-weight:600;color:#4c8dff;white-space:nowrap;min-width:56px;text-align:right;');
      scopeRow.appendChild(scopeLabel);
      scopeRow.appendChild(slider);
      scopeRow.appendChild(countBadge);

      var preview = el('div', 'background:#111;border-radius:6px;padding:8px;max-height:190px;overflow:auto;margin-bottom:10px;');

      var advToggle = el('div', 'cursor:pointer;user-select:none;color:#9aa0a6;margin-bottom:8px;', '\\u25B8 ' + S.advanced);
      var advBox = el('div', 'display:none;margin-bottom:10px;');
      var fields = {};
      [['item', S.labelItem], ['title', S.labelTitle], ['link', S.labelLink]].forEach(function(pair){
        var row = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
        row.appendChild(el('span', 'width:52px;color:#9aa0a6;flex-shrink:0;', pair[1]));
        var input = document.createElement('input');
        input.type = 'text';
        input.style.cssText = 'flex:1;min-width:0;background:#000;color:#e8eaed;border:1px solid #3c4043;border-radius:4px;padding:4px 6px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;';
        input.addEventListener('input', function(){
          state.manual = true;
          state.item = fields.item.value.trim();
          state.title = fields.title.value.trim();
          state.link = fields.link.value.trim();
          render(true);
        });
        fields[pair[0]] = input;
        row.appendChild(input);
        advBox.appendChild(row);
      });
      // An empty link selector is meaningful, not missing: the row element is the anchor.
      fields.link.placeholder = S.rowIsLink;
      advToggle.addEventListener('click', function(){
        var open = advBox.style.display === 'none';
        advBox.style.display = open ? 'block' : 'none';
        advToggle.textContent = (open ? '\\u25BE ' : '\\u25B8 ') + S.advanced;
      });

      var footer = el('div', 'display:flex;justify-content:flex-end;gap:8px;');
      var cancelBtn = el('button', 'background:transparent;color:#e8eaed;border:1px solid #3c4043;border-radius:6px;padding:6px 14px;cursor:pointer;font:13px system-ui;', S.cancel);
      var confirmBtn = el('button', 'background:#4c8dff;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font:600 13px system-ui;');
      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);

      panel.appendChild(scopeRow);
      panel.appendChild(preview);
      panel.appendChild(advToggle);
      panel.appendChild(advBox);
      panel.appendChild(footer);
      document.documentElement.appendChild(panel);

      function isOurs(node){
        return !node || node === bar || node === hover || node === marks
          || bar.contains(node) || panel.contains(node) || marks.contains(node);
      }

      function fill(str, n){ return str.split('{{count}}').join(String(n)); }

      // Draws at most MARK_CAP outlines; the count badge always reports the true
      // total, so a long list is under-drawn but never under-reported.
      var MARK_CAP = 60;
      function paintMarks(nodes){
        marks.textContent = '';
        nodes.slice(0, MARK_CAP).forEach(function(node){
          var r = node.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return;
          marks.appendChild(el('div', 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;border:2px solid #34c759;background:rgba(52,199,89,0.12);border-radius:3px;pointer-events:none;'));
        });
      }

      function render(keepManual){
        var cur = state.manual ? { itemSelector: state.item, titleSelector: state.title, linkSelector: state.link }
                               : state.levels[state.index];
        if (!cur) return;
        if (!keepManual){
          state.item = cur.itemSelector;
          state.title = cur.titleSelector;
          state.link = cur.linkSelector;
          fields.item.value = state.item;
          fields.title.value = state.title;
          fields.link.value = state.link;
        }
        try { state.nodes = Array.prototype.slice.call(document.querySelectorAll(state.item)); }
        catch (e) { state.nodes = []; }
        var rows = YobiPick.extract(state.item, state.title, state.link);

        countBadge.textContent = fill(S.rowCount, rows.length);
        confirmBtn.textContent = fill(S.confirm, rows.length);
        confirmBtn.disabled = rows.length === 0;
        confirmBtn.style.opacity = rows.length === 0 ? '0.5' : '1';

        preview.textContent = '';
        rows.slice(0, 5).forEach(function(r){
          var line = el('div', 'display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #222;');
          line.appendChild(el('div', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', r.title || '\\u2014'));
          line.appendChild(el('div', 'width:150px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:#8ab4f8;font:12px ui-monospace,monospace;', r.link || S.noLink));
          preview.appendChild(line);
        });
        if (rows.length > 5) preview.appendChild(el('div', 'padding-top:5px;color:#9aa0a6;', fill(S.more, rows.length - 5)));

        paintMarks(state.nodes);
      }

      function onSlider(){
        state.manual = false;
        state.index = parseInt(slider.value, 10) || 0;
        render(false);
      }
      slider.addEventListener('input', onSlider);

      function adopt(clicked){
        var result = YobiPick.analyze(clicked);
        if (!result){
          bar.textContent = S.notAList;
          return;
        }
        bar.textContent = S.banner + '   ·   ' + S.cancelHint;
        state.levels = result.levels;
        state.index = result.index;
        state.manual = false;
        slider.max = String(Math.max(0, result.levels.length - 1));
        slider.value = String(result.index);
        slider.disabled = result.levels.length < 2;
        panel.style.display = 'block';
        render(false);
      }

      function onMove(e){
        if (panel.style.display === 'block' && panel.contains(e.target)) { hover.style.display = 'none'; return; }
        var node = document.elementFromPoint(e.clientX, e.clientY);
        if (isOurs(node)){ hover.style.display = 'none'; return; }
        var r = node.getBoundingClientRect();
        hover.style.display = 'block';
        hover.style.left = r.left + 'px';
        hover.style.top = r.top + 'px';
        hover.style.width = r.width + 'px';
        hover.style.height = r.height + 'px';
      }

      function onClick(e){
        if (panel.contains(e.target) || bar.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        var node = document.elementFromPoint(e.clientX, e.clientY);
        if (isOurs(node)) return;
        adopt(node);
      }

      // Scrolling only moves the boxes — re-running the extraction every frame
      // would re-query the whole document while the page is in motion.
      var repaint = null;
      function onScroll(){
        if (repaint) return;
        repaint = requestAnimationFrame(function(){
          repaint = null;
          if (panel.style.display === 'block') paintMarks(state.nodes);
        });
      }

      function cleanup(){
        clearTimeout(giveUp);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll, true);
        [bar, hover, marks, panel].forEach(function(n){ if (n.parentNode) n.parentNode.removeChild(n); });
      }

      function finish(payload){ cleanup(); resolve(payload); }

      function onKey(e){
        if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); finish(''); }
      }

      cancelBtn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); finish(''); });
      confirmBtn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        var rows = YobiPick.extract(state.item, state.title, state.link);
        if (!rows.length) return;
        finish(JSON.stringify({
          itemSelector: state.item,
          titleSelector: state.title,
          linkSelector: state.link,
          count: rows.length,
        }));
      });

      var giveUp = setTimeout(function(){ finish(''); }, TIMEOUT_MS);

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll, true);
    });
  })()`;
}
