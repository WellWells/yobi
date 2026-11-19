import React, { Fragment, useCallback } from 'react';
import { Badge, Group, Menu } from '@mantine/core';
import { Check } from 'lucide-react';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { loginRequiredProviderForUrl } from '../../../../shared/types';
import { providerSubmodels } from '../../config/modelStops';
import { GeminiModelSubmenu } from './GeminiModelMenu';
import { PerplexityModelSubmenu } from './PerplexityModelMenu';
import { ClaudeModelSubmenu } from './ClaudeModelMenu';
import { ChatgptModelSubmenu } from './ChatgptModelMenu';
import { MenuChoiceItem } from './MenuChoiceItem';

interface ModelMenuItemsProps {
  value: string;
  onChange: (url: string) => void;
}

export const ModelMenuItems: React.FC<ModelMenuItemsProps> = ({ value, onChange }) => {
  const { sections } = useProviderModels(value);
  const accountStatuses = useAppStore((state) => state.accountStatuses);
  const geminiModels = useAppStore((state) => state.geminiModels);
  const perplexityModels = useAppStore((state) => state.perplexityModels);
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
                  <Badge size="xs" variant="light" color="gray">
                    {t('settings.modelSources.hidden')}
                  </Badge>
                )}
                {showLoginBadge && (
                  <Badge size="xs" variant="light">
                    {t('chat.model.badge.loginRequired')}
                  </Badge>
                )}
              </>
            );
            const itemStyle: React.CSSProperties = { fontWeight: isSelected ? 600 : 400 };

            // A provider opens its own model menu once its list has been read; Claude and ChatGPT
            // only while signed in, and ChatGPT only on a plan with several versions (Plus). The
            // same answer decides what Shift+Tab and `/model` step through.
            const subProvider = providerSubmodels(
              model.url,
              { geminiModels, claudeModels, chatgptModels, perplexityModels, needsLogin },
            )?.provider;

            const row = {
              model,
              isSelected,
              badges,
              itemStyle,
              itemRef: isSelected ? scrollSelectedIntoView : undefined,
              onChange,
            };
            if (subProvider === 'gemini' && geminiModels) {
              return <GeminiModelSubmenu key={model.url} {...row} state={geminiModels} />;
            }
            if (subProvider === 'claude' && claudeModels) {
              return <ClaudeModelSubmenu key={model.url} {...row} state={claudeModels} />;
            }
            if (subProvider === 'perplexity' && perplexityModels) {
              return <PerplexityModelSubmenu key={model.url} {...row} state={perplexityModels} />;
            }
            if (subProvider === 'chatgpt' && chatgptModels) {
              return <ChatgptModelSubmenu key={model.url} {...row} state={chatgptModels} />;
            }

            return (
              <MenuChoiceItem
                key={model.url}
                kind="radio"
                checked={isSelected}
                closeMenuOnClick
                ref={isSelected ? scrollSelectedIntoView : undefined}
                onClick={() => onChange(model.url)}
                icon={<Icon size={15} />}
                rightSection={
                  showLoginBadge || model.hidden || isSelected ? (
                    <Group gap={6} wrap="nowrap">
                      {badges}
                      {isSelected && <Check size={13} color="var(--mantine-color-accent-text)" />}
                    </Group>
                  ) : null
                }
                style={itemStyle}
              >
                {model.label}
              </MenuChoiceItem>
            );
          })}
        </Fragment>
      ))}
    </>
  );
};
