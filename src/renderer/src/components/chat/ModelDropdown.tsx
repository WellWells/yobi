import React, { useState } from 'react';
import { Menu, Tooltip } from '@mantine/core';
import type { ModelOption } from '../../config/models';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, findModelOption } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { PROVIDER_URLS } from '../../../../shared/types';
import { selectedGeminiModel } from '../../../../shared/geminiModels';
import { selectedClaudeModel } from '../../../../shared/claudeModels';
import { ComposerPill } from './ComposerPill';
import { GeminiModelSummary } from './GeminiModelMenu';
import { ClaudeModelSummary } from './ClaudeModelMenu';
import { ChatgptModelSummary, chatgptSummaryText } from './ChatgptModelMenu';
import { ModelMenuItems } from './ModelMenuItems';

/** What the composer has always used: below every modal layer, above the page. */
const DEFAULT_MENU_Z = 20;

interface ModelDropdownProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  menuDirection?: 'up' | 'down';
  /**
   * Above the composer this sits on the page, so a low value keeps it under anything modal.
   * Inside a modal it has to clear `Z_MODAL`, or the menu opens behind the overlay — visible,
   * dimmed, and unclickable.
   */
  zIndex?: number;
  tooltipLabel?: string;
  renderTrigger?: (ctx: {
    open: boolean;
    current: ModelOption;
    toggle: () => void;
    disabled: boolean;
  }) => React.ReactNode;
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({
  value,
  onChange,
  disabled = false,
  menuDirection = 'up',
  zIndex = DEFAULT_MENU_Z,
  tooltipLabel,
  renderTrigger,
}) => {
  const [open, setOpen] = useState(false);
  const { extraModels } = useProviderModels(value);
  const geminiModels = useAppStore((s) => s.geminiModels);
  const claudeModels = useAppStore((s) => s.claudeModels);
  const chatgptModels = useAppStore((s) => s.chatgptModels);
  const current = findModelOption(value, extraModels);
  const CurrentIcon = current.icon;
  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const geminiModel = current.url === PROVIDER_URLS.gemini ? selectedGeminiModel(geminiModels) : null;
  const claudeModel = current.url === PROVIDER_URLS.claude ? selectedClaudeModel(claudeModels) : null;
  const chatgptText = current.url === PROVIDER_URLS.chatgpt ? chatgptSummaryText(chatgptModels) : null;
  const summary = geminiModel && geminiModels
    ? <GeminiModelSummary state={geminiModels} />
    : claudeModel && claudeModels
      ? <ClaudeModelSummary state={claudeModels} />
      : chatgptText && chatgptModels ? <ChatgptModelSummary state={chatgptModels} /> : null;
  const subLabel = geminiModel?.label ?? claudeModel?.label ?? chatgptText;
  const defaultTrigger = (
    <ComposerPill
      variant="subtle"
      icon={<CurrentIcon size={14} />}
      label={summary ? <>{current.label}{summary}</> : current.label}
      ariaLabel={subLabel ? `${current.label} ${subLabel}` : current.label}
      open={open}
      disabled={disabled}
      onClick={toggle}
    />
  );

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position={menuDirection === 'up' ? 'top-end' : 'bottom-end'}
      offset={6}
      withinPortal
      zIndex={zIndex}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          minWidth: 180,
          maxHeight: PROVIDER_DROPDOWN_MAX_HEIGHT,
          overflowY: 'auto',
        },
        item: {
          fontSize: 'var(--font-size-md)',
        },
      }}
    >
      <Menu.Target>
        {renderTrigger
          ? renderTrigger({ open, current, toggle, disabled })
          : tooltipLabel
            ? (
              <Tooltip label={tooltipLabel} position="top">
                {defaultTrigger}
              </Tooltip>
            )
            : defaultTrigger}
      </Menu.Target>

      <Menu.Dropdown>
        <ModelMenuItems value={value} onChange={onChange} />
      </Menu.Dropdown>
    </Menu>
  );
};
