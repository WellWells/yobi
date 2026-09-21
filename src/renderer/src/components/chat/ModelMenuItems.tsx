import React, { Fragment, useCallback } from 'react';
import { Badge, Group, Menu } from '@mantine/core';
import { Check } from 'lucide-react';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { loginRequiredProviderForUrl } from '../../../../shared/types';
import { providerSubmodels } from '../../config/modelStops';
import { GeminiModelSubmenu } from './GeminiModelMenu';
import { ClaudeModelSubmenu } from './ClaudeModelMenu';
import { ChatgptModelSubmenu } from './ChatgptModelMenu';

interface ModelMenuItemsProps {
  value: string;
  onChange: (url: string) => void;
}

export const ModelMenuItems: React.FC<ModelMenuItemsProps> = ({ value, onChange }) => {
  const { sections } = useProviderModels(value);
  const accountStatuses = useAppStore((state) => state.accountStatuses);
  const geminiModels = useAppStore((state) => state.geminiModels);
  const claudeModels = useAppStore((state) => state.claudeModels);
  const chatgptModels = useAppStore((state) => state.chatgptModels);
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
            const badges = (
              <>
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
              </>
            );
            const itemStyle: React.CSSProperties = {
              background: isSelected ? 'var(--mantine-color-accent-dim)' : undefined,
              color: isSelected ? 'var(--mantine-color-accent)' : undefined,
              fontWeight: isSelected ? 600 : 400,
            };

            // A provider opens its own model menu once its list has been read; Claude and ChatGPT
            // only while signed in, and ChatGPT only on a plan with several versions (Plus). The
            // same answer decides what Shift+Tab and `/model` step through.
            const subProvider = providerSubmodels(
              model.url,
              { geminiModels, claudeModels, chatgptModels, needsLogin },
            )?.provider;

            if (subProvider === 'gemini' && geminiModels) {
              return (
                <GeminiModelSubmenu
                  key={model.url}
                  model={model}
                  state={geminiModels}
                  isSelected={isSelected}
                  badges={badges}
                  itemStyle={itemStyle}
                  itemRef={isSelected ? scrollSelectedIntoView : undefined}
                  onChange={onChange}
                />
              );
            }

            if (subProvider === 'claude' && claudeModels) {
              return (
                <ClaudeModelSubmenu
                  key={model.url}
                  model={model}
                  state={claudeModels}
                  isSelected={isSelected}
                  badges={badges}
                  itemStyle={itemStyle}
                  itemRef={isSelected ? scrollSelectedIntoView : undefined}
                  onChange={onChange}
                />
              );
            }

            if (subProvider === 'chatgpt' && chatgptModels) {
              return (
                <ChatgptModelSubmenu
                  key={model.url}
                  model={model}
                  state={chatgptModels}
                  isSelected={isSelected}
                  badges={badges}
                  itemStyle={itemStyle}
                  itemRef={isSelected ? scrollSelectedIntoView : undefined}
                  onChange={onChange}
                />
              );
            }

            return (
              <Menu.Item
                key={model.url}
                ref={isSelected ? scrollSelectedIntoView : undefined}
                onClick={() => onChange(model.url)}
                leftSection={<Icon size={15} />}
                rightSection={
                  showLoginBadge || model.hidden || isSelected ? (
                    <Group gap={6} wrap="nowrap">
                      {badges}
                      {isSelected && <Check size={13} color="var(--mantine-color-accent)" />}
                    </Group>
                  ) : null
                }
                style={itemStyle}
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
