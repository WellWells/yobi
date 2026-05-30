// src/renderer/src/views/agentflow/examples.ts
// Built-in template flows for AgentFlow. Each entry is a full FlowDefinition
// with placeholder values the user can fill in after loading.
import type { FlowDefinition } from '../../../../shared/types';

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FlowTemplate {
  key: string;
  titleKey: string;
  descKey: string;
  build: (t: (key: string) => string) => FlowDefinition;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: 'rss_telegram',
    titleKey: 'agentflow.templates.rss',
    descKey: 'agentflow.templates.rss.desc',
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: 'RSS → Telegram',
      description: t('agentflow.templates.rss.flowdesc'),
      enabled: false,
      trigger: {
        type: 'cron',
        scheduleMode: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        scheduleHour: 8,
        scheduleMinute: 0,
        repeatWithinDay: false,
        repeatEveryUnit: 'minutes',
        repeatEveryValue: 30,
        endHour: 23,
        endMinute: 59,
        cronExpression: '0 8 * * 1-5',
      },
      steps: [
        {
          id: makeId(),
          type: 'rss',
          label: t('agentflow.templates.rss.step.feed'),
          config: {
            url: '[Fill in RSS URL]',
            fetchContent: 'false',
            checkpoint: '',
            lastLinks: '',
          },
          outputKey: 'rss_1',
        },
        {
          id: makeId(),
          type: 'stop',
          label: t('agentflow.templates.step.stop_noNew'),
          config: { value: '{{rss_1}}' },
          outputKey: 'stop_1',
        },
        {
          id: makeId(),
          type: 'llm',
          label: t('agentflow.templates.rss.step.llm'),
          config: {
            prompt: '[Fill in your system prompt]\n\n{{rss_1}}',
            provider: 'https://gemini.google.com/',
            saveToHistory: 'false',
            exportFormat: '',
            exportTitle: '',
            exportFileName: '',
            exportShowProvider: 'false',
            exportShowTimestamp: 'false',
          },
          outputKey: 'llm_1',
        },
        {
          id: makeId(),
          type: 'bot',
          label: t('agentflow.templates.step.bot'),
          config: {
            chatId: '',
            message: '{{llm_1}}',
          },
          outputKey: 'bot_1',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
  {
    key: 'web_monitor',
    titleKey: 'agentflow.templates.webMonitor',
    descKey: 'agentflow.templates.webMonitor.desc',
    build: (t): FlowDefinition => ({
      id: makeId(),
      name: 'Web Monitor → Telegram',
      description: t('agentflow.templates.webMonitor.flowdesc'),
      enabled: false,
      trigger: {
        type: 'cron',
        scheduleMode: 'weekly',
        weekdays: [1, 2, 3, 4, 5],
        scheduleHour: 9,
        scheduleMinute: 0,
        repeatWithinDay: false,
        repeatEveryUnit: 'minutes',
        repeatEveryValue: 60,
        endHour: 23,
        endMinute: 59,
        cronExpression: '0 9 * * 1-5',
      },
      steps: [
        {
          id: makeId(),
          type: 'scraper',
          label: t('agentflow.templates.webMonitor.step.scraper'),
          config: {
            url: '[Fill in website URL]',
            itemSelector: '.item',
            titleSelector: '.title',
            linkSelector: 'a',
            maxItems: '5',
          },
          outputKey: 'scraper_1',
        },
        {
          id: makeId(),
          type: 'stop',
          label: t('agentflow.templates.step.stop_noNew'),
          config: { value: '{{scraper_1}}' },
          outputKey: 'stop_1',
        },
        {
          id: makeId(),
          type: 'llm',
          label: t('agentflow.templates.webMonitor.step.llm'),
          config: {
            prompt: '[Fill in analysis prompt]\n\n{{scraper_1}}',
            provider: 'https://gemini.google.com/',
            saveToHistory: 'false',
            exportFormat: '',
            exportTitle: '',
            exportFileName: '',
            exportShowProvider: 'false',
            exportShowTimestamp: 'false',
          },
          outputKey: 'llm_1',
        },
        {
          id: makeId(),
          type: 'bot',
          label: t('agentflow.templates.step.bot'),
          config: {
            chatId: '',
            message: '{{llm_1}}',
          },
          outputKey: 'bot_1',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  },
];
