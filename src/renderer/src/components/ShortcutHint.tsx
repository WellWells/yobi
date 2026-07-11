import React from 'react';
import { Group, Kbd } from '@mantine/core';
import { isMac } from '../utils/keyLabels';

// On macOS, modifier keys are conventionally shown as glyphs; on Windows/Linux the
// spelled-out word reads more clearly (mirrors utils/keyLabels.ts). Non-modifier
// tokens (F2, D, Del…) pass through unchanged.
const MAC_MODIFIER_GLYPH: Record<string, string> = {
  ctrl: '⌘',
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
};

function displayToken(token: string): string {
  if (!isMac) return token;
  return MAC_MODIFIER_GLYPH[token.toLowerCase()] ?? token;
}

const capStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 500,
  lineHeight: 1.4,
  color: 'var(--text-muted)',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 5px',
  boxShadow: 'none',
};

interface ShortcutHintProps {
  /** A shortcut combo such as "F2", "Del", "Ctrl+D" or "Alt + R". */
  combo: string;
}

// Renders a keyboard shortcut as one small keycap per key. Splitting on `+` gives
// each key its own cap (["Alt","R"] → two caps) so a combo reads like physical
// keys; modifier words become platform glyphs on macOS. Wraps Mantine <Kbd> to
// keep the semantic <kbd> element, tuned down to a subtle chip that sits neatly
// in a dense context menu's rightSection.
export const ShortcutHint: React.FC<ShortcutHintProps> = ({ combo }) => {
  const keys = combo.split('+').map((key) => key.trim()).filter(Boolean);
  return (
    <Group gap={3} wrap="nowrap" component="span">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} style={capStyle}>
          {displayToken(key)}
        </Kbd>
      ))}
    </Group>
  );
};
