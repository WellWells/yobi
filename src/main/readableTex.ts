/**
 * A formula as plain Unicode text, for a message that cannot typeset math (Telegram, LINE).
 *
 * A model's everyday arithmetic — `60.97 \times 11.3 = 688.96 \text{ 元}` — read as raw TeX in a
 * chat bubble. This covers what such answers write: operators and relations, Greek letters,
 * `\frac`, `\sqrt`, `\text{…}`, function names and scripts. Anything else (a matrix, `\\`, `&`,
 * an accent, a command not listed here) gives null, and the caller sends the TeX as written.
 */

const SYMBOLS: Readonly<Record<string, string>> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  approx: '≈', neq: '≠', ne: '≠', le: '≤', leq: '≤', ge: '≥', geq: '≥', ll: '≪', gg: '≫',
  equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', mapsto: '↦',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⇒', iff: '⇔',
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫', oint: '∮',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  angle: '∠', perp: '⊥', parallel: '∥', mid: '∣', therefore: '∴', because: '∵',
  degree: '°', prime: '′', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  quad: ' ', qquad: ' ', displaystyle: '', textstyle: '', limits: '', nolimits: '',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** `\sin x` reads as `sin x`. */
const FUNCTION_NAMES = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg', 'mod', 'bmod',
]);

/** Read as math inside. */
const WRAPPERS = new Set(['mathrm', 'mathbf', 'mathit', 'mathsf', 'boldsymbol', 'operatorname', 'boxed']);
/** Read as words inside. */
const TEXT_WRAPPERS = new Set(['text', 'textrm', 'textbf', 'textit', 'mbox']);
const FRACTIONS = new Set(['frac', 'dfrac', 'tfrac']);

/** One-character commands. `\\` (a new row) is not here: it means layout this cannot show. */
const ESCAPES: Readonly<Record<string, string>> = {
  ',': ' ', ';': ' ', ':': ' ', '>': ' ', ' ': ' ', '!': '',
  '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', '_': '_', '|': '‖',
};

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', '′': '′', '*': '*',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ',
  l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ',
  x: 'ˣ', y: 'ʸ', z: 'ᶻ', T: 'ᵀ',
};

const SUBSCRIPT: Readonly<Record<string, string>> = {
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', ',': ',',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ',
  r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

/** Roots Unicode has a sign for. */
const ROOTS: Readonly<Record<string, string>> = { 2: '√', 3: '∛', 4: '∜' };

interface Reader {
  src: string;
  at: number;
  /** The atom just read must not run into a word before it (`2\frac12`, `n\log n`). */
  lead: boolean;
  /** …nor into a word, bracket or root after it (`\frac{1}{2}mv^2`, `\sqrt{2}x`). */
  trail: boolean;
}

/** What a word written right before a fraction or operator would merge with. */
const WORD_END = /[\p{L}\p{N}.′°)]$/u;
const WORD_START = /^[\p{L}\p{N}.]/u;
const ONE_TERM = /^(?:[\p{L}\p{N}.′°]+|∞)$/u;
/**
 * What would read as part of a fraction's denominator or a root's radicand. A period only when a
 * digit follows (`.5`): one closing the sentence (`= \frac{a}{b}.`) stays on the formula.
 */
const OPERAND_FOLLOWER = /^(?:[\p{L}\p{N}([√∛∜]|\.\d)/u;

export function readableTex(tex: string): string | null {
  try {
    const reader: Reader = { src: tex, at: 0, lead: false, trail: false };
    const text = readSequence(reader, null).replace(/\s+/g, ' ').trim();
    return text || null;
  } catch {
    // Unreadable, or nested deeper than the stack: either way the TeX goes out as written.
    return null;
  }
}

function giveUp(): never {
  throw new Error('unreadable TeX');
}

/**
 * Atoms up to `closer` (consumed), or to the end when `closer` is null. A space goes between a
 * fraction, root or operator and a neighbour it would otherwise read as part of: TeX sets them
 * apart without the source writing a space. The sequence's own `lead`/`trail` are those of its
 * first and last atoms, so `{\frac12}m` is kept apart as well.
 *
 * A script is TeX's script on the whole atom before it, so that atom is bracketed first when it
 * is more than one term: a fraction or root (`\frac{a}{b}^2` is `(a/b)²`, not `a/b²`), or a
 * braced group (`{\frac{a}{b}}^2`, `{x+y}^2`). Spaces between the two are skipped, as TeX skips
 * them. An empty group is TeX's empty base, not nothing: `a = {}^{14}C` is a prescript on C, so a
 * script after it neither brackets nor joins the atom before it, and a fraction or root before it
 * stays apart (`\frac{a}{b}{}^2` is `a/b ²`, not `a/b²`).
 */
function readSequence(reader: Reader, closer: '}' | ']' | null): string {
  let out = '';
  let lead: boolean | null = null;
  let trail = false;
  /** Where the last atom that is not blank starts in `out`, and what opened it. */
  let last = -1;
  let lastOpener = '';
  /** Where an empty group (`{}`) ends in `out` while no atom has followed it yet, else -1. */
  let emptyBase = -1;
  while (reader.at < reader.src.length) {
    if (reader.src[reader.at] === closer) {
      reader.at += 1;
      return endSequence(reader, out, lead, trail);
    }
    const opener = reader.src[reader.at];
    const atom = readAtom(reader);
    if (opener === '{' && !atom.trim()) {
      last = -1;
      emptyBase = out.length;
      continue;
    }
    if (!atom) continue;
    if (!atom.trim()) {
      out += atom;
      continue;
    }
    const scripted = opener === '^' || opener === '_';
    if (scripted && emptyBase >= 0) {
      out = out.slice(0, emptyBase);
      if (trail && /\S$/.test(out)) out += ' ';
    } else if (scripted && last >= 0) {
      const base = out.slice(last).trim();
      if (trail || (lastOpener === '{' && !isOneTerm(base))) out = `${out.slice(0, last)}(${base})`;
      else out = out.trimEnd();
    }
    const apart = (reader.lead && WORD_END.test(out) && WORD_START.test(atom))
      || (trail && !scripted && /\S$/.test(out) && OPERAND_FOLLOWER.test(`${atom}${reader.src[reader.at] ?? ''}`));
    if (apart) out += ' ';
    last = out.length;
    lastOpener = opener;
    out += atom;
    lead ??= reader.lead;
    trail = reader.trail;
    emptyBase = -1;
  }
  return closer === null ? endSequence(reader, out, lead, trail) : giveUp();
}

/** One term, or already bracketed as a whole: a script on it needs no brackets of its own. */
function isOneTerm(text: string): boolean {
  if (ONE_TERM.test(text)) return true;
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return depth === 0;
}

function endSequence(reader: Reader, out: string, lead: boolean | null, trail: boolean): string {
  reader.lead = lead ?? false;
  reader.trail = trail;
  return out;
}

function readAtom(reader: Reader): string {
  const ch = reader.src[reader.at];
  reader.at += 1;
  reader.lead = false;
  reader.trail = false;
  switch (ch) {
    case '\\':
      return readCommand(reader);
    case '{':
      return readSequence(reader, '}');
    case '^':
      return plain(reader, script(readArgument(reader), SUPERSCRIPT, '^'));
    case '_':
      return plain(reader, script(readArgument(reader), SUBSCRIPT, '_'));
    case '~':
      return ' ';
    case '}':
    case '&':
    case '%':
    case '$':
    case '#':
      return giveUp();
    default:
      return ch;
  }
}

/** A command's argument: a `{…}` group, a command, or one character. Never empty. */
function readArgument(reader: Reader): string {
  skipSpaces(reader);
  if (reader.at >= reader.src.length) giveUp();
  return readAtom(reader).trim() || giveUp();
}

const COMMAND_NAME = /[a-zA-Z]+/y;

function readCommand(reader: Reader): string {
  COMMAND_NAME.lastIndex = reader.at;
  const name = COMMAND_NAME.exec(reader.src)?.[0] ?? reader.src[reader.at] ?? '';
  if (!name) giveUp();
  reader.at += name.length;
  const symbol = lookup(ESCAPES, name) ?? lookup(SYMBOLS, name);
  if (symbol !== undefined) return symbol;
  if (FUNCTION_NAMES.has(name)) return name === 'bmod' ? ' mod ' : operator(reader, name);
  if (WRAPPERS.has(name)) {
    skipSpaces(reader);
    // `\operatorname*` only moves the limits; a star after any other wrapper is not the argument.
    if (reader.src[reader.at] === '*') {
      if (name !== 'operatorname') giveUp();
      reader.at += 1;
    }
    const inner = readArgument(reader);
    return name === 'operatorname' ? operator(reader, inner) : inner;
  }
  if (TEXT_WRAPPERS.has(name)) return readWords(reader);
  if (FRACTIONS.has(name)) {
    const numerator = readArgument(reader);
    const denominator = readArgument(reader);
    return operand(reader, `${group(numerator)}/${group(denominator)}`);
  }
  if (name === 'sqrt') return readRoot(reader);
  if (name === 'left' || name === 'right') {
    skipSpaces(reader);
    // `\left.` is an invisible delimiter; any other is read as the next atom.
    if (reader.src[reader.at] === '.') reader.at += 1;
    return '';
  }
  return giveUp();
}

function readRoot(reader: Reader): string {
  skipSpaces(reader);
  let degree = '2';
  if (reader.src[reader.at] === '[') {
    reader.at += 1;
    degree = readSequence(reader, ']').trim();
  }
  const sign = lookup(ROOTS, degree) ?? giveUp();
  // A sign covers only what is bracketed after it: `√2x` reads as √2·x, so `\sqrt{2x}` is `√(2x)`.
  const radicand = readArgument(reader);
  return operand(reader, `${sign}${/^(?:\d+(?:\.\d+)?|\p{L})$/u.test(radicand) ? radicand : `(${radicand})`}`);
}

const LIMITS = /\\(?:no)?limits(?![a-zA-Z])/y;

/**
 * A function or operator name with the scripts written on it (`\log_2`, `\sin^2`, `\lim\limits_x`),
 * then a space before an argument that would otherwise run into it: `\log_2{n}` is `log₂ n`,
 * `\operatorname{sgn}{x}` is `sgn x`, while `\sin(x)` stays together.
 */
function operator(reader: Reader, name: string): string {
  let text = name;
  for (;;) {
    const at = nextNonSpace(reader);
    const mark = reader.src[at];
    LIMITS.lastIndex = at;
    if (mark === '^' || mark === '_') {
      reader.at = at + 1;
      text += script(readArgument(reader), mark === '^' ? SUPERSCRIPT : SUBSCRIPT, mark);
    } else if (LIMITS.test(reader.src)) {
      reader.at = LIMITS.lastIndex;
    } else {
      break;
    }
  }
  reader.lead = true;
  reader.trail = false;
  return /[\\{\p{L}\p{N}]/u.test(reader.src[reader.at] ?? '') ? `${text} ` : text;
}

/**
 * A fraction or root takes exactly its own arguments: `readSequence` keeps what comes next apart
 * (`\frac{1}{2}mv^2` is `1/2 mv²`, not `1/2mv²`) and brackets it under a script written after it
 * (`\frac{a}{b}^2` is `(a/b)²`, not `a/b²`).
 */
function operand(reader: Reader, text: string): string {
  reader.lead = true;
  reader.trail = true;
  return text;
}

/** An atom nothing needs to be kept apart from. */
function plain(reader: Reader, text: string): string {
  reader.lead = false;
  reader.trail = false;
  return text;
}

/** `\text{…}`'s words, which are not math: only TeX's escaped specials are undone. */
function readWords(reader: Reader): string {
  skipSpaces(reader);
  if (reader.src[reader.at] !== '{') return giveUp();
  const end = reader.src.indexOf('}', reader.at);
  const inner = end < 0 ? giveUp() : reader.src.slice(reader.at + 1, end);
  reader.at = end + 1;
  const words = inner.replace(/\\([%$&#_ ])/g, '$1');
  return /[\\{$]/.test(words) ? giveUp() : words;
}

/** Unicode scripts where every character has one, else `^(…)` as plain text writes it. */
function script(text: string, table: Readonly<Record<string, string>>, mark: '^' | '_'): string {
  if (mark === '^' && text === SYMBOLS.circ) return '°';
  const compact = text.replace(/\s+/g, '');
  const chars = [...compact];
  if (chars.length > 0 && chars.every((c) => lookup(table, c) !== undefined)) return chars.map((c) => table[c]).join('');
  return chars.length === 1 ? `${mark}${compact}` : `${mark}(${text})`;
}

/** A fraction's operand, in parentheses unless it is one term. */
function group(text: string): string {
  return ONE_TERM.test(text) ? text : `(${text})`;
}

/** Own keys only: `\constructor` must not find `Object.prototype.constructor`. */
function lookup(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function nextNonSpace(reader: Reader): number {
  let at = reader.at;
  while (/\s/.test(reader.src[at] ?? '')) at += 1;
  return at;
}

function skipSpaces(reader: Reader): void {
  reader.at = nextNonSpace(reader);
}
