import React from 'react';
import { Badge } from '@mantine/core';
import { EyeOff } from 'lucide-react';

/**
 * Marks a model source (a web provider, a key, a key group) hidden from the model menu. A word and
 * an icon, never an opacity over the row: the row at 0.55 opacity falls to 2.32:1 in the light theme
 * (WCAG 1.4.3). The row's name turns muted alongside it.
 */
export const HiddenSourceBadge: React.FC<{ t: (key: string) => string }> = ({ t }) => (
  <Badge variant="default" size="sm" leftSection={<EyeOff size={11} aria-hidden />} style={{ flexShrink: 0 }}>
    {t('settings.modelSources.hidden')}
  </Badge>
);

/** The colour of a source's name: muted while it is hidden, the row's usual colour otherwise. */
export function sourceNameColor(hidden: boolean): string {
  return hidden ? 'var(--text-muted)' : 'var(--mantine-color-default-color)';
}
