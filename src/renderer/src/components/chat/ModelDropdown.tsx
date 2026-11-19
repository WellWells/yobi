import React, { useState } from 'react';
import { Menu } from '@mantine/core';
import type { ModelOption } from '../../config/models';
import { findModelOption } from '../../config/models';
import { MODEL_MENU_MIDDLEWARES } from '../../config/modelMenuSizing';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { PROVIDER_URLS } from '../../../../shared/types';
import { selectedGeminiModel } from '../../../../shared/geminiModels';
import { selectedClaudeModel } from '../../../../shared/claudeModels';
import { ComposerPill } from './ComposerPill';
import { TooltipTarget } from '../TooltipTarget';
import { GeminiModelSummary } from './GeminiModelMenu';
import { PerplexityModelSummary } from './PerplexityModelMenu';
import { selectedPerplexityModel } from '../../../../shared/perplexityModels';
import { ClaudeModelSummary } from './ClaudeModelMenu';
import { ChatgptModelSummary, chatgptSummaryText } from './ChatgptModelMenu';
import { ModelMenuItems } from './ModelMenuItems';
import { composerMenuPosition, type MenuDirection } from './composerMenuDirection';

/** Below every modal layer, above the page. */
const DEFAULT_MENU_Z = 20;

interface ModelDropdownProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  menuDirection?: MenuDirection;
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
  const perplexityModels = useAppStore((s) => s.perplexityModels);
  const current = findModelOption(value, extraModels);
  const CurrentIcon = current.icon;
  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const geminiModel = current.url === PROVIDER_URLS.gemini ? selectedGeminiModel(geminiModels) : null;
  const claudeModel = current.url === PROVIDER_URLS.claude ? selectedClaudeModel(claudeModels) : null;
  const chatgptText = current.url === PROVIDER_URLS.chatgpt ? chatgptSummaryText(chatgptModels) : null;
  const perplexityModel = current.url === PROVIDER_URLS.perplexity ? selectedPerplexityModel(perplexityModels) : null;
  const summary = geminiModel && geminiModels
    ? <GeminiModelSummary state={geminiModels} />
    : claudeModel && claudeModels
      ? <ClaudeModelSummary state={claudeModels} />
      : chatgptText && chatgptModels
        ? <ChatgptModelSummary state={chatgptModels} />
        : perplexityModel && perplexityModels ? <PerplexityModelSummary state={perplexityModels} /> : null;
  const subLabel = geminiModel?.label ?? claudeModel?.label ?? chatgptText ?? perplexityModel?.label;
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
      position={composerMenuPosition(menuDirection, 'end')}
      offset={6}
      withinPortal
      zIndex={zIndex}
      middlewares={MODEL_MENU_MIDDLEWARES}
      styles={{
        dropdown: {
          background: 'var(--mantine-color-default)',
          borderColor: 'var(--mantine-color-default-border)',
          minWidth: 180,
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
              // Off while the menu is open: the menu ends right at the pill, so the hint sat on
              // its last row for as long as the pointer stayed on the pill it had just clicked.
              <TooltipTarget label={tooltipLabel} position="top" disabled={open}>
                {defaultTrigger}
              </TooltipTarget>
            )
            : defaultTrigger}
      </Menu.Target>

      <Menu.Dropdown>
        <ModelMenuItems value={value} onChange={onChange} />
      </Menu.Dropdown>
    </Menu>
  );
};
