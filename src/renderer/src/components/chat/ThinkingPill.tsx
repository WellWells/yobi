import React, { useEffect, useState } from 'react';
import { Menu } from '@mantine/core';
import { Lightbulb } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { loginRequiredProviderForUrl } from '../../../../shared/types';
import {
  thinkingControl,
  thinkingLevelLabel,
  thinkingPillLabel,
  type ThinkingLevelProvider,
  type ThinkingProvider,
} from '../../config/thinkingControl';
import { ComposerPill } from './ComposerPill';
import { chooseGeminiModel } from './GeminiModelMenu';
import { chooseClaudeModel } from './ClaudeModelMenu';
import { chooseChatgptModel } from './ChatgptModelMenu';

/** Same layer as the model menu beside it: under anything modal, above the page. */
const MENU_Z = 20;

function setThinking(provider: ThinkingProvider, on: boolean): void {
  if (provider === 'gemini') chooseGeminiModel({ extendedThinking: on });
  else if (provider === 'claude') chooseClaudeModel({ thinking: on });
  else chooseChatgptModel({ thinking: on });
}

function setLevel(provider: ThinkingLevelProvider, id: string): void {
  if (provider === 'claude') chooseClaudeModel({ effort: id });
  else chooseChatgptModel({ effort: id });
}

/**
 * The composer's thinking control for the provider being sent to: one click where the page offers
 * only a switch, a small menu where it also offers levels, and disabled where there is nothing to
 * set. It edits the same per-provider setting the hotkey, flows and bots run on.
 */
export const ThinkingPill: React.FC<{ url: string }> = ({ url }) => {
  const t = useI18nStore((s) => s.t);
  const gemini = useAppStore((s) => s.geminiModels);
  const claude = useAppStore((s) => s.claudeModels);
  const chatgpt = useAppStore((s) => s.chatgptModels);
  const signedOut = useAppStore((s) => {
    const provider = loginRequiredProviderForUrl(url);
    return provider !== null && s.accountStatuses[provider] === false;
  });
  const [open, setOpen] = useState(false);
  // A menu left open for one provider must not pop open again on the way back to it.
  useEffect(() => setOpen(false), [url]);

  const control = thinkingControl(url, { gemini, claude, chatgpt, signedOut });
  const label = thinkingPillLabel(control, t);
  const icon = <Lightbulb size={14} />;

  if (control.kind !== 'menu') {
    const on = control.kind === 'toggle' && control.on;
    return (
      <ComposerPill
        variant="subtle"
        icon={icon}
        label={label}
        chevron={false}
        open={false}
        accent={on}
        aria-pressed={control.kind === 'toggle' ? on : undefined}
        disabled={control.kind === 'none'}
        onClick={() => {
          if (control.kind === 'toggle') setThinking(control.provider, !control.on);
        }}
      />
    );
  }

  const { provider } = control;
  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position="top-end"
      offset={6}
      withinPortal
      zIndex={MENU_Z}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          minWidth: 160,
        },
        item: { fontSize: 'var(--font-size-md)' },
      }}
    >
      <Menu.Target>
        <ComposerPill
          variant="subtle"
          icon={icon}
          label={label}
          open={open}
          accent={control.active}
          onClick={() => setOpen((current) => !current)}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {control.toggle && (
          <>
            <Menu.CheckboxItem
              checked={control.toggle.on}
              onChange={(checked) => setThinking(provider, checked)}
            >
              {t('chat.thinkingMode.label')}
            </Menu.CheckboxItem>
            <Menu.Divider />
          </>
        )}
        <Menu.Label>{t('chat.thinkingMode.effort')}</Menu.Label>
        <Menu.RadioGroup value={control.level} onChange={(id) => setLevel(provider, id)}>
          {control.levels.map((level) => (
            <Menu.RadioItem key={level.id} value={level.id} closeMenuOnClick>
              {thinkingLevelLabel(provider, level, t)}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Dropdown>
    </Menu>
  );
};
