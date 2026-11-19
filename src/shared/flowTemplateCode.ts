// The code of the templates' js steps that need no AI. It imports nothing, so the release
// self-test runs exactly this code through the js step's runner without the gallery's UI.
// A js step's code is interpolated before it runs: none of it may contain "{{".

/**
 * `/cur <amount> <currency> [currency]`: the amount and the two currency codes in whatever way a
 * group writes them ("580 cny", "usd119.99=twd", "3600 NGN TWD", "459rm", "100美金換日圓"), with
 * no AI. Each js step returns one part (a js step has no sub-variables); a missing target is the
 * home currency, and a lone home currency converts to USD (TWD for a USD home). "" = not a
 * conversion, so the template answers with how to ask instead of failing in the forex step.
 */
export function currencyPartCode(part: 'amount' | 'base' | 'target'): string {
  return [
    String.raw`const raw = String(vars['input'] || '').replace(/,/g, '').replace(/NT\$/gi, ' TWD ').trim();`,
    String.raw`const home = String(vars['var.homeCurrency'] || 'TWD').trim().toUpperCase();`,
    String.raw`const NAMES = [['新台幣','TWD'],['新臺幣','TWD'],['台幣','TWD'],['臺幣','TWD'],['美金','USD'],['美元','USD'],['日圓','JPY'],['日幣','JPY'],['日元','JPY'],['円','JPY'],['人民幣','CNY'],['人民币','CNY'],['港幣','HKD'],['港币','HKD'],['歐元','EUR'],['欧元','EUR'],['英鎊','GBP'],['英镑','GBP'],['韓元','KRW'],['韩元','KRW'],['韓幣','KRW'],['泰銖','THB'],['泰铢','THB'],['新加坡幣','SGD'],['新幣','SGD'],['澳幣','AUD'],['澳元','AUD'],['加幣','CAD'],['馬幣','MYR'],['越南盾','VND'],['$','USD'],['€','EUR'],['£','GBP'],['¥','JPY'],['₩','KRW']];`,
    String.raw`const WORDS = { RM: 'MYR', RMB: 'CNY', NT: 'TWD', NTD: 'TWD', YEN: 'JPY' };`,
    String.raw`const SKIP = ['TO', 'IN', 'INTO', 'AND', 'THE', 'FOR', 'IS', 'EQ'];`,
    'const found = [];',
    'const taken = [];',
    'for (const [name, code] of NAMES.slice().sort((a, b) => b[0].length - a[0].length)) {',
    '  let at = raw.indexOf(name);',
    '  while (at >= 0) {',
    '    const end = at + name.length;',
    '    if (!taken.some(([s, e]) => at < e && end > s)) { taken.push([at, end]); found.push([at, code]); }',
    '    at = raw.indexOf(name, end);',
    '  }',
    '}',
    String.raw`for (const m of raw.matchAll(/[A-Za-z]+/g)) {`,
    '  const word = m[0].toUpperCase();',
    '  const code = WORDS[word] || (word.length === 3 && !SKIP.includes(word) ? word : \'\');',
    '  if (code) found.push([m.index, code]);',
    '}',
    'const codes = found.sort((a, b) => a[0] - b[0]).map(([, code]) => code).filter((code, i, all) => i === 0 || code !== all[i - 1]);',
    "if (codes.length === 0) return '';",
    String.raw`const number = raw.match(/\d+(?:\.\d+)?/);`,
    'const base = codes[0];',
    "const target = codes[1] || (base === home ? (home === 'USD' ? 'TWD' : 'USD') : home);",
    `return ${part === 'amount' ? "number ? number[0] : '1'" : part};`,
  ].join('\n');
}

/**
 * The TestFlight watch reads the join page itself, without a browser, and answers with a code:
 * "open", "closed" (full or not accepting: either way no place), "invalid" (a 404, or no join
 * button at all) or "" when the page could not be read this time (the next run tries again).
 *
 * It reads structure only, never Apple's sentences: the page's wording follows a language Apple
 * picks, and matching it would work for one language's users and silently fail for the rest.
 * The signal is the "open in TestFlight" button (`.st-button` > the `itms-beta://` link): it
 * carries a label only while the beta has places, and is an empty element when the beta is full
 * or closed.
 */
export const TESTFLIGHT_STATUS_CODE = [
  "const url = String(vars['var.tfUrl'] || '').trim().split('?')[0];",
  String.raw`if (!/^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+\/?$/.test(url)) return 'invalid';`,
  "let html = '';",
  'try {',
  "  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });",
  "  if (res.status === 404) return 'invalid';",
  "  if (!res.ok) return '';",
  '  html = await res.text();',
  "} catch (e) { return ''; }",
  String.raw`const button = html.match(/class="st-button"[^>]*>\s*<a\b[^>]*href="itms-beta:[^"]*"[^>]*>([\s\S]*?)<\/a>/);`,
  "if (!button) return 'invalid';",
  String.raw`return button[1].replace(/<[^>]+>/g, '').trim() ? 'open' : 'closed';`,
].join('\n');

/**
 * The App watch's verdict: "first" when there is nothing to compare with (the first run, or no
 * earlier text kept), "version" when the version line changed, otherwise "price" — price and
 * in-app purchases are the rest of the watched text.
 */
export const APP_WATCH_KIND_CODE = [
  "const previous = String(vars['changed_1.previous'] || '');",
  "if (String(vars['changed_1.isFirstRun'] || '') === '1' || !previous) return 'first';",
  "const firstLine = (text) => String(text || '').split(String.fromCharCode(10))[0].replace(/\\s+/g, ' ').trim();",
  "return firstLine(previous) !== firstLine(vars['watch_1']) ? 'version' : 'price';",
].join('\n');

