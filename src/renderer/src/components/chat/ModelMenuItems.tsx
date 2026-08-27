import React, { Fragment, useCallback } from 'react';
import { Badge, Group, Menu } from '@mantine/core';
import { Check } from 'lucide-react';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { loginRequiredProviderForUrl } from '../../../../shared/types';

interface ModelMenuItemsProps {
  value: string;
  onChange: (url: string) => void;
}

export const ModelMenuItems: React.FC<ModelMenuItemsProps> = ({ value, onChange }) => {
  const { sections } = useProviderModels(value);
  const accountStatuses = useAppStore((state) => state.accountStatuses);
  const t = useI18nStore((state) => state.t);

  const scrollSelectedIntoView = useCallback((node: HTMLButtonElement | null) => {
    if (node) requestAnimationFrame(() => node.scrollIntoView({ block: 'nearest' }));
  }, []);

  const needsLogin = (url: string): boolean => {
    const provider = loginRequiredProviderForUrl(url);
    return provider !== null && accountStatuses[provider] === false;
  };

  return (
    <>
      {sections.map((section) => (
        <Fragment key={section.label ?? 'providers'}>
          {section.label && <Menu.Label>{section.label}</Menu.Label>}
          {section.models.map((model) => {
            const Icon = model.icon;
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
    </>
  );
};
