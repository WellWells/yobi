import React, { Fragment, useCallback, useState } from 'react';
import { Badge, Group, Menu, Tooltip, UnstyledButton } from '@mantine/core';
import { Check, ChevronDown } from 'lucide-react';
import type { ModelOption } from '../../config/models';
import { PROVIDER_DROPDOWN_MAX_HEIGHT, findModelOption, getModelIconByUrl } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { loginRequiredProviderForUrl } from '../../../../shared/types';
import styles from './ModelDropdown.module.css';

interface ModelDropdownProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
  menuDirection?: 'up' | 'down';
  /** When set (and no custom renderTrigger), the default pill shows this hover tooltip. */
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
  tooltipLabel,
  renderTrigger,
}) => {
  const [open, setOpen] = useState(false);
  // Pass the current value: the auto-reselect in ChatView runs in an effect, and on
  // the render before it lands a filtered list would drop the selection, making
  // findModelOption() fall back to Gemini and flash the wrong name on the trigger.
  const { sections, extraModels } = useProviderModels(value);
  const accountStatuses = useAppStore((state) => state.accountStatuses);
  const t = useI18nStore((state) => state.t);
  // The menu scrolls once enough models are configured, and a BYOK pick sits at the
  // bottom — open on the current selection rather than on an unrelated item. Menu.Dropdown
  // mounts inside a Transition, so this runs as a ref callback (an effect keyed on `open`
  // fires a commit too early, while the item is still unmounted).
  const scrollSelectedIntoView = useCallback((node: HTMLButtonElement | null) => {
    if (node) requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest' }));
  }, []);

  // Only badge a model the user cannot use right now: it needs an account AND we have
  // confirmed there is none. A null status (first check still in flight) stays unbadged
  // so the menu does not flicker a warning at every app start.
  const needsLogin = (url: string): boolean => {
    const provider = loginRequiredProviderForUrl(url);
    return provider !== null && accountStatuses[provider] === false;
  };
  const current = findModelOption(value, extraModels);
  const CurrentIcon = getModelIconByUrl(current.url);
  const toggle = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  const defaultTrigger = (
    <UnstyledButton
      onClick={toggle}
      disabled={disabled}
      className={styles.trigger}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-default)',
        color: 'var(--mantine-color-text)',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 'var(--font-size-base)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <CurrentIcon size={14} />
      {current.label}
      <ChevronDown
        size={12}
        style={{ color: 'var(--mantine-color-dimmed)', marginLeft: 1, transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </UnstyledButton>
  );

  return (
    <Menu
      opened={open}
      onChange={setOpen}
      position={menuDirection === 'up' ? 'top-end' : 'bottom-end'}
      offset={6}
      withinPortal
      zIndex={20}
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
        {sections.map((section) => (
          <Fragment key={section.label ?? 'providers'}>
            {section.label && <Menu.Label>{section.label}</Menu.Label>}
            {section.models.map((model) => {
              const Icon = getModelIconByUrl(model.url);
              const isSelected = value === model.url;
              const showLoginBadge = needsLogin(model.url);

              return (
                <Menu.Item
                  key={model.url}
                  ref={isSelected ? scrollSelectedIntoView : undefined}
                  onClick={() => onChange(model.url)}
                  leftSection={<Icon size={15} />}
                  rightSection={
                    showLoginBadge || model.hidden || isSelected ? (
                      <Group gap={6} wrap="nowrap">
                        {model.hidden && (
                          <Badge size="xs" variant="light" color="gray" style={{ textTransform: 'none' }}>
                            {t('settings.modelSources.hidden')}
                          </Badge>
                        )}
                        {showLoginBadge && (
                          <Badge size="xs" variant="light" style={{ textTransform: 'none' }}>
                            {t('chat.model.badge.loginRequired')}
                          </Badge>
                        )}
                        {isSelected && <Check size={13} color="var(--mantine-color-accent)" />}
                      </Group>
                    ) : null
                  }
                  style={{
                    background: isSelected ? 'var(--mantine-color-accent-dim)' : undefined,
                    color: isSelected ? 'var(--mantine-color-accent)' : undefined,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {model.label}
                </Menu.Item>
              );
            })}
          </Fragment>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};

