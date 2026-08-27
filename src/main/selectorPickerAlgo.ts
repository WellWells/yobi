export const PICKER_ALGO_SOURCE = String.raw`
var YobiPick = (function(){
  var MAX_CLIMB = 10;
  var MIN_PEERS = 2;
  var MIN_ROW_HIT_RATIO = 0.6;
  var MIN_LINK_DISTINCT_RATIO = 0.8;

  function qsa(sel, root){
    if (!sel) return [];
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    catch (e) { return []; }
  }

  function countMatches(sel){ return qsa(sel).length; }

  function safeMatches(el, sel){
    if (!el || !sel || !el.matches) return false;
    try { return el.matches(sel); } catch (e) { return false; }
  }

  function tagOf(el){ return el.tagName ? el.tagName.toLowerCase() : '*'; }

  function escClass(c){
    try { return '.' + CSS.escape(c); } catch (e) { return '.' + c; }
  }

  function isHashClass(c){
    if (!c) return true;
    if (c.length > 30) return true;
    if (/^(css|sc|jsx|emotion|svelte)-[a-z0-9]{5,}$/i.test(c)) return true;
    if (!/[-_]/.test(c) && c.length >= 8 && /[0-9]/.test(c) && /[a-z]/i.test(c)) return true;
    return false;
  }

  function classesOf(el){
    if (!el || el.nodeType !== 1) return [];
    var raw = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : el.className;
    if (typeof raw !== 'string') return [];
    return raw.split(/\s+/).filter(Boolean).filter(function(c){ return !isHashClass(c); });
  }

  function classFreq(c){
    try { return document.getElementsByClassName(c).length; } catch (e) { return Number.MAX_SAFE_INTEGER; }
  }

  function idSelectorOf(el){
    var id = el.getAttribute ? el.getAttribute('id') : '';
    if (!id || /^[0-9]/.test(id)) return '';
    try { return '#' + CSS.escape(id); } catch (e) { return ''; }
  }

  function signatureOf(el){
    if (!el || el.nodeType !== 1) return '';
    return tagOf(el) + '|' + classesOf(el).slice().sort().join('.');
  }

  function peersOf(node){
    var parent = node.parentElement;
    if (!parent) return [];
    var sig = signatureOf(node);
    return Array.prototype.filter.call(parent.children, function(c){ return signatureOf(c) === sig; });
  }

  function levelsFor(clicked){
    var out = [];
    var node = clicked;
    var depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth < MAX_CLIMB){
      var peers = peersOf(node);
      if (peers.length >= MIN_PEERS) out.push({ row: node, peers: peers });
      node = node.parentElement;
      depth++;
    }
    return out;
  }

  function commonClasses(nodes){
    return classesOf(nodes[0]).filter(function(c){
      return nodes.every(function(n){ return classesOf(n).indexOf(c) !== -1; });
    });
  }

  function minimalRowSelector(nodes){
    var tag = tagOf(nodes[0]);
    var target = nodes.length;
    if (countMatches(tag) === target) return tag;
    var ranked = commonClasses(nodes).slice().sort(function(a, b){ return classFreq(a) - classFreq(b); });
    var sel = tag;
    var picked = [];
    for (var i = 0; i < ranked.length; i++){
      picked.push(ranked[i]);
      sel = tag + picked.map(escClass).join('');
      if (countMatches(sel) === target) return sel;
    }
    return sel;
  }

  function buildItemSelector(nodes){
    var sel = minimalRowSelector(nodes);
    var target = nodes.length;
    if (countMatches(sel) === target) return sel;
    var node = nodes[0].parentElement;
    var depth = 0;
    while (node && node !== document.documentElement && depth < 5){
      var idSel = idSelectorOf(node);
      var seg = idSel || (tagOf(node) + classesOf(node).map(escClass).join(''));
      sel = seg + ' > ' + sel;
      if (countMatches(sel) === target) return sel;
      if (idSel) break;
      node = node.parentElement;
      depth++;
    }
    return sel;
  }

  function leafSelector(node, row){
    var tag = tagOf(node);
    if (qsa(tag, row).length === 1) return tag;
    var classes = classesOf(node);
    var sel = tag;
    var picked = [];
    for (var i = 0; i < classes.length; i++){
      picked.push(classes[i]);
      sel = tag + picked.map(escClass).join('');
      if (qsa(sel, row).length === 1) return sel;
    }
    return sel;
  }

  function textOf(el){
    if (!el) return '';
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function resolvesInRows(rows, sel){
    if (!sel) return false;
    var hits = rows.filter(function(r){
      var el = safeMatches(r, sel) ? r : r.querySelector(sel);
      return !!el && textOf(el).length > 0;
    }).length;
    return hits >= 2 && hits >= rows.length * MIN_ROW_HIT_RATIO;
  }

  function relativePath(row, target, rows){
    if (!target || target === row) return '';
    var chain = [];
    var node = target;
    while (node && node !== row){
      chain.unshift(node);
      node = node.parentElement;
    }
    if (!chain.length) return '';
    var parts = chain.map(function(n){ return leafSelector(n, row); });
    for (var start = parts.length - 1; start >= 0; start--){
      var sel = parts.slice(start).join(' ');
      if (resolvesInRows(rows, sel)) return sel;
    }
    return parts[parts.length - 1];
  }

  function hrefIn(rowEl, sel){
    var el = sel ? (safeMatches(rowEl, sel) ? rowEl : rowEl.querySelector(sel)) : rowEl;
    if (!el || !el.getAttribute) return '';
    return el.getAttribute('href') || '';
  }

  function linksDistinct(rows, sel){
    var links = rows.map(function(r){ return hrefIn(r, sel); }).filter(Boolean);
    if (links.length < 2) return false;
    var unique = {};
    var n = 0;
    links.forEach(function(l){ if (!unique[l]){ unique[l] = 1; n++; } });
    return n >= Math.max(2, Math.ceil(links.length * MIN_LINK_DISTINCT_RATIO));
  }

  function linkCandidateElements(rowEl, clicked){
    var out = [];
    function push(el){
      if (el && rowEl.contains(el) && out.indexOf(el) === -1) out.push(el);
    }
    if (clicked && clicked.closest) push(clicked.closest('a[href]'));
    if (clicked && clicked.querySelector) push(clicked.querySelector('a[href]'));
    push(rowEl.querySelector('a[href]'));
    return out;
  }

  function resolveLinkSelector(rowEl, clicked, rows){
    var candidates = [];
    linkCandidateElements(rowEl, clicked).forEach(function(el){
      var sel = (el === rowEl) ? '' : relativePath(rowEl, el, rows);
      if (candidates.indexOf(sel) === -1) candidates.push(sel);
    });
    if (candidates.indexOf('a[href]') === -1) candidates.push('a[href]');
    for (var i = 0; i < candidates.length; i++){
      if (linksDistinct(rows, candidates[i])) return candidates[i];
    }
    return candidates[0];
  }

  function extract(itemSel, titleSel, linkSel){
    return qsa(itemSel).map(function(el){
      var titleEl = titleSel ? (safeMatches(el, titleSel) ? el : el.querySelector(titleSel)) : el;
      return { title: textOf(titleEl), link: hrefIn(el, linkSel) };
    });
  }

  function isValid(rows){
    if (rows.length < 2) return false;
    if (rows.filter(function(r){ return r.title; }).length < 2) return false;
    var links = rows.map(function(r){ return r.link; }).filter(Boolean);
    if (links.length < 2) return false;
    var unique = {};
    var n = 0;
    links.forEach(function(l){ if (!unique[l]){ unique[l] = 1; n++; } });
    return n >= Math.max(2, Math.ceil(links.length * MIN_LINK_DISTINCT_RATIO));
  }

  function describe(level, clicked){
    var itemSelector = buildItemSelector(level.peers);
    var matched = qsa(itemSelector);
    if (matched.length < 2) return null;
    var titleSelector = relativePath(level.row, clicked, matched);
    var linkSelector = resolveLinkSelector(level.row, clicked, matched);
    var rows = extract(itemSelector, titleSelector, linkSelector);
    return {
      itemSelector: itemSelector,
      titleSelector: titleSelector,
      linkSelector: linkSelector,
      rows: rows,
      count: matched.length,
      valid: isValid(rows),
    };
  }

  function analyze(clicked, preferredIndex){
    if (!clicked || clicked.nodeType !== 1) return null;
    var levels = levelsFor(clicked).map(function(lv){ return describe(lv, clicked); })
      .filter(function(d){ return !!d; });
    if (!levels.length) return null;
    var index = -1;
    if (typeof preferredIndex === 'number' && levels[preferredIndex]) index = preferredIndex;
    if (index === -1){
      for (var i = 0; i < levels.length; i++){
        if (levels[i].valid){ index = i; break; }
      }
    }
    if (index === -1) index = 0;
    return { levels: levels, index: index, current: levels[index] };
  }

  return {
    analyze: analyze,
    extract: extract,
    classesOf: classesOf,
    isHashClass: isHashClass,
    buildItemSelector: buildItemSelector,
    signatureOf: signatureOf,
  };
})();
`;
