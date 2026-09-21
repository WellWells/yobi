import React from 'react';
import { Center } from '@mantine/core';
import type { FlowTemplate } from './examples';
import { SKILL_ICON } from './skills';
import classes from './TemplateIcon.module.css';

interface TemplateIconProps {
  template: FlowTemplate;
  /** Chip size. The glyph inside stays 14px — it is shared with the step icons. */
  size: number;
}

/**
 * The template's identity chip, shared by the gallery tile and the setup wizard so the thing
 * you clicked and the thing that opens are visibly the same template.
 */
export const TemplateIcon: React.FC<TemplateIconProps> = ({ template, size }) => {
  const Override = template.icon;
  return (
    <Center
      w={size}
      h={size}
      className={classes.chip}
      style={{
        '--tpl-bg': `var(--mantine-color-${template.hue}-light)`,
        // On a dark theme `-light` is a dark tint of the hue, so the glyph needs a bright
        // mid-tone to read as coloured at all; on a light theme it is the reverse.
        '--tpl-fg-dark': `var(--mantine-color-${template.hue}-4)`,
        '--tpl-fg-light': `var(--mantine-color-${template.hue}-light-color)`,
      } as React.CSSProperties}
    >
      {Override ? <Override size={14} /> : SKILL_ICON[template.primarySkill]}
    </Center>
  );
};
