import { createElement, memo, type ComponentType } from 'react';
import { Bot, Compass, Sparkles } from 'lucide-react';
import { PROVIDER_LABELS, PROVIDER_URLS, buildDuckaiModelUrl } from '../../../shared/types';
import type { DuckaiModelInfo } from '../../../shared/types';

export { buildDuckaiModelUrl };

interface ModelIconProps {
  size?: number;
}

export type ModelIcon = ComponentType<ModelIconProps>;

const DuckDuckGoIcon = memo(({ size = 14 }: ModelIconProps) => {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 512 448',
      fill: 'currentColor',
      xmlns: 'http://www.w3.org/2000/svg',
      style: { display: 'inline-block', verticalAlign: 'middle' },
    },
    createElement('path', { d: 'M377.5,163.7c12.9-16.1,18-37.5,14.9-57.8-5-37.9-38-65.4-76.7-64.6-32,.4-61.9,21.2-71,52-9.8,31-.3,64.1,25.3,84.2,18.3,13.4,18,41-2.1,52.1-25.2,10-139.5,39.7-165.4,47-13.9,3.5-27.7-5.6-40.3-10.5-6.7-3.4-17-6.3-18,4.6,7.5,73.2,71.3,130.8,144.7,135.8,18.7,1,34.8.3,54.3.5,20.5,0,39,0,59,.1,22.8.1,45.1-4.7,63.3-19.1,44.7-34,46.2-99.6,8.8-137.7-2.7-2.8-5.6-5.7-7.5-9.1-3.6-6.3-3.9-13.9-3.9-21-.8-20.2,1.8-40.5,14.5-56.4h.1ZM394.8,210.4c-1.6,1.6-1.6,4.2-1.6,7.2-.5,6.9,2.3,11.4,6.9,16.2,15.7,18.4,26.2,39.7,29.6,64,11.5,70.1-42.2,136.8-114.5,139.5-28.3.5-58.5,0-87.4.2-19.9.1-39.4.7-58.7-2.7C81.4,421.8,12.9,343.3,12.3,253.1c-1.4-15.5,9.9-28.9,25.6-28.7,6.5,0,12.1,2.7,17.9,5.2,10.5,4.3,24.5,11.3,36.1,15.1,6.3,1.8,12.4-.2,18.5-1.9,3.8-1.1,7.2-2,11.2-3.1,51.3-14.4,91.1-25.7,125.8-35.1,1.8-.6,3.3-1.4,2.4-3.2-.7-1.3-1.9-2.3-3.1-3.4-8.1-7-14.9-15.2-20.5-24.3-35.4-57.5-8.8-134.3,54.6-156.7,55-20.4,120.1,11.9,137.8,67.5,1.7,6.3,4,11.3,11.1,11.7,12.2,1.3,24.8-.3,36.8-1.9,5.6-.7,11.5-1.4,16.9.5,12.2,4.6,17.5,16,16.1,28.6-2.7,51.3-48.4,88.6-98.6,85.4-2.5,0-4.8.3-6.1,1.5h0ZM424,128.3c-1.7,1.6-2.1,4.2-2.6,6.4-.9,4.6-2,9.1-3.4,13.6-2.6,8.3-6.4,16.1-10.9,23.6-6,9,5.2,6.6,10.6,5.9,25.8-4.1,45.1-21.6,51.8-46.2,2.1-7-1.3-8-7.5-7.1-6.8.8-13,1.5-19.7,1.9-3.9.2-7.9.3-11.8.3-2.2,0-4.7,0-6.4,1.6h-.1ZM321.8,277.1c-11.5,86.3-115,126.6-184,75.3-7.2-5.1-14.2-13.2-10.4-22.4,5-11.2,16-12.2,25-4.8,36.3,31.1,98,23.7,125.4-16.9,6.6-9.2,11.3-19.6,13.8-30.6,1.3-5.6,2.9-12.3,8.2-15.4,11.1-6.3,23.3,1.9,22.1,14.6v.2Z' }),
    createElement('circle', { cx: 332.2, cy: 125, r: 22.9 })
  );
});

export interface ModelOption {
  label: string;
  url: string;
  icon: ModelIcon;
}

export const MODELS: ModelOption[] = [
  { label: PROVIDER_LABELS.gemini, url: PROVIDER_URLS.gemini, icon: Sparkles },
  { label: PROVIDER_LABELS.perplexity, url: PROVIDER_URLS.perplexity, icon: Compass },
  { label: PROVIDER_LABELS.chatgpt, url: PROVIDER_URLS.chatgpt, icon: Bot },
];

export const DEFAULT_MODEL_URL = MODELS[0].url;

const MODEL_ICON_BY_URL: Record<string, ModelIcon> = {
  [PROVIDER_URLS.gemini]: Sparkles,
  [PROVIDER_URLS.perplexity]: Compass,
  [PROVIDER_URLS.chatgpt]: Bot,
} as const;

export function isDuckaiUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes('duck.ai');
  } catch {
    return false;
  }
}

export function makeDuckaiModelOption(info: DuckaiModelInfo): ModelOption {
  return {
    label: `Duck AI · ${info.label}`,
    url: buildDuckaiModelUrl(info.id),
    icon: DuckDuckGoIcon,
  };
}

export function findModelOption(url: string, extraModels: ModelOption[] = []): ModelOption {
  const all = [...MODELS, ...extraModels];
  return all.find((m) => m.url === url) ?? MODELS[0];
}

export function getModelIconByUrl(url: string): ModelIcon {
  if (MODEL_ICON_BY_URL[url]) return MODEL_ICON_BY_URL[url];
  if (isDuckaiUrl(url)) return DuckDuckGoIcon;
  return Sparkles;
}
