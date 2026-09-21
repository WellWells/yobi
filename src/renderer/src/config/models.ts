import type { ComponentType } from 'react';
import { KeyRound, Layers } from 'lucide-react';
import { PROVIDER_LABELS, PROVIDER_URLS, buildByokUrl, buildByokGroupUrl, isByokGroupUrl, isByokUrl, isModelUrlHidden } from '../../../shared/types';
import type { ByokGroupSnapshot, ByokInstanceSnapshot, ByokProviderType, HiddenSources } from '../../../shared/types';
import { ClaudeIcon, GeminiIcon, GrokIcon, KimiIcon, OpenAiIcon, OpenRouterIcon, PerplexityIcon } from './brandIcons';

interface ModelIconProps {
  size?: number;
}

export type ModelIcon = ComponentType<ModelIconProps>;

export interface ModelOption {
  label: string;
  url: string;
  icon: ModelIcon;
  shortLabel?: string;
}

export const MODELS: ModelOption[] = [
  { label: PROVIDER_LABELS.gemini, url: PROVIDER_URLS.gemini, icon: GeminiIcon },
  { label: PROVIDER_LABELS.claude, url: PROVIDER_URLS.claude, icon: ClaudeIcon },
  { label: PROVIDER_LABELS.chatgpt, url: PROVIDER_URLS.chatgpt, icon: OpenAiIcon },
  { label: PROVIDER_LABELS.perplexity, url: PROVIDER_URLS.perplexity, icon: PerplexityIcon },
];

export const DEFAULT_MODEL_URL = MODELS[0].url;

const MODEL_ICON_BY_URL: Record<string, ModelIcon> = {
  [PROVIDER_URLS.gemini]: GeminiIcon,
  [PROVIDER_URLS.perplexity]: PerplexityIcon,
  [PROVIDER_URLS.chatgpt]: OpenAiIcon,
  [PROVIDER_URLS.claude]: ClaudeIcon,
} as const;

const BYOK_TYPE_ICONS: Partial<Record<ByokProviderType, ModelIcon>> = {
  openai: OpenAiIcon,
  anthropic: ClaudeIcon,
  gemini: GeminiIcon,
  openrouter: OpenRouterIcon,
  xai: GrokIcon,
  moonshot: KimiIcon,
  perplexity: PerplexityIcon,
};

export function getByokTypeIcon(type: ByokProviderType): ModelIcon {
  return BYOK_TYPE_ICONS[type] ?? KeyRound;
}

export function makeByokModelOption(instance: ByokInstanceSnapshot): ModelOption {
  return {
    label: instance.name,
    url: buildByokUrl(instance.id),
    icon: getByokTypeIcon(instance.providerType),
  };
}

export function makeByokGroupModelOption(group: ByokGroupSnapshot): ModelOption {
  return {
    label: group.name,
    url: buildByokGroupUrl(group.id),
    icon: Layers,
  };
}

export function makeByokGroupModels(groups: ByokGroupSnapshot[]): ModelOption[] {
  return groups.filter((group) => group.memberIds.length > 0).map(makeByokGroupModelOption);
}

export function findModelOption(url: string, extraModels: ModelOption[] = []): ModelOption {
  const all = [...MODELS, ...extraModels];
  return all.find((m) => m.url === url) ?? MODELS[0];
}

export interface ProviderSelectOption {
  value: string;
  label: string;
}

export interface ProviderSelectGroup {
  group: string;
  items: ProviderSelectOption[];
}

export interface ProviderSelectExtras {
  byokModels: ModelOption[];
  byokGroupModels: ModelOption[];
}

export interface ProviderSelectLabels {
  byok: string;
  byokGroups: string;
}

export interface PickerModel extends ModelOption {
  hidden?: boolean;
}

export interface ProviderSection {
  label: string | null;
  models: PickerModel[];
}

const NO_HIDDEN: HiddenSources = { providers: [], byokIds: [], byokGroupIds: [] };

export const PROVIDER_DROPDOWN_MAX_HEIGHT = 320;

export function providerExtraModels(extras: ProviderSelectExtras): ModelOption[] {
  return [...extras.byokModels, ...extras.byokGroupModels];
}

function applyHidden(
  models: ModelOption[],
  hidden: HiddenSources,
  keepVisibleUrl: string | undefined,
): PickerModel[] {
  const out: PickerModel[] = [];
  for (const model of models) {
    if (!isModelUrlHidden(model.url, hidden)) {
      out.push(model);
    } else if (model.url === keepVisibleUrl) {
      out.push({ ...model, hidden: true });
    }
  }
  return out;
}

export function buildProviderSections(
  extras: ProviderSelectExtras,
  labels: ProviderSelectLabels,
  opts: { hidden?: HiddenSources; keepVisibleUrl?: string } = {},
): ProviderSection[] {
  const hidden = opts.hidden ?? NO_HIDDEN;
  const keep = opts.keepVisibleUrl;
  const candidates: ProviderSection[] = [
    { label: null, models: applyHidden(MODELS, hidden, keep) },
    { label: labels.byok, models: applyHidden(extras.byokModels, hidden, keep) },
    { label: labels.byokGroups, models: applyHidden(extras.byokGroupModels, hidden, keep) },
  ];
  return candidates.filter((section) => section.models.length > 0);
}

export function providerSectionsToSelectData(
  sections: ProviderSection[],
  hiddenSuffix = '',
): (ProviderSelectOption | ProviderSelectGroup)[] {
  const toOption = (model: PickerModel): ProviderSelectOption => ({
    value: model.url,
    label: model.hidden ? `${model.label}${hiddenSuffix}` : model.label,
  });
  return sections.flatMap<ProviderSelectOption | ProviderSelectGroup>((section) => (
    section.label === null
      ? section.models.map(toOption)
      : [{ group: section.label, items: section.models.map(toOption) }]
  ));
}

export function visibleModels(extras: ProviderSelectExtras, hidden: HiddenSources): ModelOption[] {
  return [...MODELS, ...providerExtraModels(extras)]
    .filter((model) => !isModelUrlHidden(model.url, hidden));
}

export function getModelIconByUrl(url: string): ModelIcon {
  if (MODEL_ICON_BY_URL[url]) return MODEL_ICON_BY_URL[url];
  if (isByokGroupUrl(url)) return Layers;
  if (isByokUrl(url)) return KeyRound;
  return GeminiIcon;
}
