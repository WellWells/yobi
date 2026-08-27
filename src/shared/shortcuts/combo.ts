import type { ElectronInputLike, KeyboardEventLike } from './types';

const MOD_COMMAND_OR_CONTROL = 'CommandOrControl';
const MOD_COMMAND = 'Command';
const MOD_CONTROL = 'Control';
const MOD_ALT = 'Alt';
const MOD_SHIFT = 'Shift';

const MODIFIER_ORDER = [MOD_COMMAND_OR_CONTROL, MOD_COMMAND, MOD_CONTROL, MOD_ALT, MOD_SHIFT] as const;

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: MOD_COMMAND_OR_CONTROL,
  cmdorctrl: MOD_COMMAND_OR_CONTROL,
  command: MOD_COMMAND,
  cmd: MOD_COMMAND,
  meta: MOD_COMMAND,
  super: MOD_COMMAND,
  control: MOD_CONTROL,
  ctrl: MOD_CONTROL,
  alt: MOD_ALT,
  option: MOD_ALT,
  shift: MOD_SHIFT,
};

const KEY_ALIASES: Record<string, string> = {
  del: 'Delete',
  delete: 'Delete',
  return: 'Enter',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  ',': 'Comma',
  comma: 'Comma',
  '+': 'Plus',
  plus: 'Plus',
  '=': 'Plus',
  equal: 'Plus',
  '-': 'Minus',
  _: 'Minus',
  minus: 'Minus',
  ' ': 'Space',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  up: 'Up',
  arrowup: 'Up',
  down: 'Down',
  arrowdown: 'Down',
  left: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  arrowright: 'Right',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
};

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight',
  'OSLeft', 'OSRight',
]);

const MODIFIER_KEY_NAMES = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph', 'CapsLock']);

const CODE_ALIASES: Record<string, string> = {
  NumpadAdd: 'Plus',
  NumpadSubtract: 'Minus',
  NumpadDecimal: 'Decimal',
  NumpadEnter: 'Enter',
  Equal: 'Plus',
  Minus: 'Minus',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backquote: 'Backquote',
  Space: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

function normaliseKeyName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const aliased = KEY_ALIASES[trimmed.toLowerCase()];
  if (aliased) return aliased;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^numpad/i.test(trimmed)) return `Numpad${trimmed.slice(6, 7).toUpperCase()}${trimmed.slice(7)}`;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function nameFromCode(code: string): string {
  if (!code || MODIFIER_CODES.has(code)) return '';
  const aliased = CODE_ALIASES[code];
  if (aliased) return aliased;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) {
    const tail = code.slice(6);
    if (/^\d$/.test(tail)) return tail;
    return code;
  }
  if (/^F\d{1,2}$/.test(code)) return code;
  return normaliseKeyName(code);
}

function keyNamesFromEvent(e: KeyboardEventLike): string[] {
  const names: string[] = [];
  const fromCode = nameFromCode(e.code);
  if (fromCode) names.push(fromCode);
  const { key } = e;
  if (key && !MODIFIER_KEY_NAMES.has(key)) {
    const fromKey = normaliseKeyName(key);
    if (fromKey && fromKey !== fromCode) names.push(fromKey);
  }
  return names;
}

function keyNameFromEvent(e: KeyboardEventLike): string {
  return keyNamesFromEvent(e)[0] ?? '';
}

export function canonicalise(raw: string): string {
  if (!raw) return '';
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    key = normaliseKeyName(part);
  }
  if (!key) return '';

  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].join('+');
}

interface ParsedCombo {
  commandOrControl: boolean;
  command: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parse(combo: string): ParsedCombo | null {
  const canonical = canonicalise(combo);
  if (!canonical) return null;
  const parts = canonical.split('+');
  const key = parts[parts.length - 1] ?? '';
  const modifiers = new Set(parts.slice(0, -1));
  return {
    commandOrControl: modifiers.has(MOD_COMMAND_OR_CONTROL),
    command: modifiers.has(MOD_COMMAND),
    control: modifiers.has(MOD_CONTROL),
    alt: modifiers.has(MOD_ALT),
    shift: modifiers.has(MOD_SHIFT),
    key,
  };
}

export interface MatchOptions {
  ignoreShift?: boolean;
  isMac?: boolean;
}

function matchesOne(e: KeyboardEventLike, parsed: ParsedCombo, options: MatchOptions): boolean {
  if (!keyNamesFromEvent(e).includes(parsed.key)) return false;
  if (e.altKey !== parsed.alt) return false;
  if (!options.ignoreShift && e.shiftKey !== parsed.shift) return false;

  if (parsed.commandOrControl) {
    const primary = options.isMac ? e.metaKey : e.ctrlKey;
    const secondary = options.isMac ? e.ctrlKey : e.metaKey;
    return primary && !secondary;
  }
  if (e.ctrlKey !== parsed.control) return false;
  if (e.metaKey !== parsed.command) return false;
  return true;
}

export function matchesCombo(
  e: KeyboardEventLike,
  combo: string,
  aliases: readonly string[] = [],
  options: MatchOptions = {},
): boolean {
  const parsed = parse(combo);
  if (parsed && matchesOne(e, parsed, options)) return true;
  for (const alias of aliases) {
    const parsedAlias = parse(alias);
    if (parsedAlias && matchesOne(e, parsedAlias, options)) return true;
  }
  return false;
}

export function comboFromEvent(e: KeyboardEventLike, isMac = false): string | null {
  const key = keyNameFromEvent(e);
  if (!key) return null;
  return canonicalise([...modifiersFromEvent(e, isMac), key].join('+'));
}

export function modifiersFromEvent(e: KeyboardEventLike, isMac = false): string[] {
  const parts: string[] = [];
  const primary = isMac ? e.metaKey : e.ctrlKey;
  const secondary = isMac ? e.ctrlKey : e.metaKey;
  if (primary) parts.push(MOD_COMMAND_OR_CONTROL);
  if (secondary) parts.push(isMac ? MOD_CONTROL : MOD_COMMAND);
  if (e.altKey) parts.push(MOD_ALT);
  if (e.shiftKey) parts.push(MOD_SHIFT);
  return parts;
}

export function comboOverlaps(a: string, b: string, isMac = false): boolean {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return false;
  if (left.key !== right.key) return false;
  if (left.alt !== right.alt || left.shift !== right.shift) return false;
  const primaryOf = (p: ParsedCombo): boolean => p.commandOrControl || (isMac ? p.command : p.control);
  const secondaryOf = (p: ParsedCombo): boolean => (isMac ? p.control : p.command);
  return primaryOf(left) === primaryOf(right) && secondaryOf(left) === secondaryOf(right);
}

export function fromElectronInput(input: ElectronInputLike): KeyboardEventLike {
  return {
    key: input.key,
    code: input.code,
    ctrlKey: input.control,
    metaKey: input.meta,
    altKey: input.alt,
    shiftKey: input.shift,
  };
}

const ELECTRON_KEY_NAMES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Semicolon: ';',
  Quote: String.fromCharCode(39),
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: String.fromCharCode(92),
  Decimal: 'numdec',
};

const ELECTRON_WORD_KEYS = new Set([
  'Plus', 'Space', 'Enter', 'Return', 'Tab', 'Escape', 'Esc', 'Backspace',
  'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Up', 'Down', 'Left', 'Right',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
]);

export function toAccelerator(combo: string, _isMac: boolean): string {
  const canonical = canonicalise(combo);
  if (!canonical) return '';
  const parts = canonical.split('+');
  const key = parts[parts.length - 1] ?? '';
  return [...parts.slice(0, -1), ELECTRON_KEY_NAMES[key] ?? key].join('+');
}

export function isRegisterableAccelerator(combo: string): boolean {
  const canonical = canonicalise(combo);
  if (!canonical) return true;
  const parts = canonical.split('+');
  const key = parts[parts.length - 1] ?? '';
  if (!key) return false;
  if (ELECTRON_KEY_NAMES[key]) return true;
  if (key.length === 1) return true;
  if (/^F\d{1,2}$/.test(key)) return true;
  if (/^num\d$/.test(key)) return true;
  return ELECTRON_WORD_KEYS.has(key);
}

const MAC_GLYPHS: Record<string, string> = {
  [MOD_COMMAND_OR_CONTROL]: '⌘',
  [MOD_COMMAND]: '⌘',
  [MOD_ALT]: '⌥',
  [MOD_SHIFT]: '⇧',
};

const DISPLAY_KEY_NAMES: Record<string, string> = {
  Delete: 'Del',
  Escape: 'Esc',
  Comma: ',',
  Plus: '+',
  Minus: '-',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

export function toTokens(combo: string, isMac: boolean): string[] {
  const canonical = canonicalise(combo);
  if (!canonical) return [];
  const parts = canonical.split('+');
  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    if (isLast) return DISPLAY_KEY_NAMES[part] ?? part;
    if (part === MOD_CONTROL) return 'Ctrl';
    if (part === MOD_COMMAND) return '⌘';
    if (isMac) return MAC_GLYPHS[part] ?? part;
    if (part === MOD_COMMAND_OR_CONTROL) return 'Ctrl';
    return part;
  });
}
