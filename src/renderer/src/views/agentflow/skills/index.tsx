// Skill config editor registry and shared skill metadata.
import React from 'react';
import {
  Terminal, Globe, MessageSquare, Clipboard, Wrench, Bot, Rss, OctagonX, StickyNote, Eye, Repeat, CircleDot,
} from 'lucide-react';
import type { SkillType } from '../../../../../shared/types';
import type { SkillConfigProps, SkillConfigEditorMap } from './types';
import { ShellConfig } from './ShellConfig';
import { BrowserConfig } from './BrowserConfig';
import { LlmConfig } from './LlmConfig';
import { ClipboardConfig } from './ClipboardConfig';
import { UtilityConfig } from './UtilityConfig';
import { BotConfig } from './BotConfig';
import { RssConfig } from './RssConfig';
import { StopConfig } from './StopConfig';
import { CommentConfig } from './CommentConfig';
import { ScraperConfig } from './ScraperConfig';
import { LoopConfig } from './LoopConfig';

const EndLoopConfig: React.FC<SkillConfigProps> = ({ t }) => (
  <span style={{ fontSize: 'var(--mantine-font-size-xs)', color: 'var(--mantine-color-dimmed)' }}>
    {t('agentflow.skill.end_loop.hint')}
  </span>
);

export {
  ShellConfig,
  BrowserConfig,
  LlmConfig,
  ClipboardConfig,
  UtilityConfig,
  BotConfig,
  RssConfig,
  StopConfig,
  CommentConfig,
  ScraperConfig,
  LoopConfig,
  EndLoopConfig,
};
export type { SkillConfigProps, SkillConfigEditor, SkillConfigEditorMap } from './types';

export const STEP_CONFIG_EDITOR: SkillConfigEditorMap = {
  shell: ShellConfig,
  browser: BrowserConfig,
  llm: LlmConfig,
  clipboard: ClipboardConfig,
  utility: UtilityConfig,
  bot: BotConfig,
  rss: RssConfig,
  stop: StopConfig,
  comment: CommentConfig,
  scraper: ScraperConfig,
  loop: LoopConfig,
  end_loop: EndLoopConfig,
};

export const SKILL_ICON: Record<SkillType, React.ReactNode> = {
  shell: <Terminal size={14} />,
  browser: <Globe size={14} />,
  llm: <MessageSquare size={14} />,
  clipboard: <Clipboard size={14} />,
  utility: <Wrench size={14} />,
  bot: <Bot size={14} />,
  rss: <Rss size={14} />,
  stop: <OctagonX size={14} />,
  comment: <StickyNote size={14} />,
  scraper: <Eye size={14} />,
  loop: <Repeat size={14} />,
  end_loop: <CircleDot size={14} />,
};

export const SKILL_COLOR: Record<SkillType, string> = {
  shell: 'var(--mantine-color-orange-light)',
  browser: 'var(--mantine-color-blue-light)',
  llm: 'var(--mantine-color-violet-light)',
  clipboard: 'var(--mantine-color-green-light)',
  utility: 'var(--mantine-color-gray-light)',
  bot: 'var(--mantine-color-cyan-light)',
  rss: 'var(--mantine-color-teal-light)',
  stop: 'var(--mantine-color-red-light)',
  comment: 'var(--mantine-color-grape-light)',
  scraper: 'var(--mantine-color-teal-light)',
  loop: 'var(--mantine-color-teal-light)',
  end_loop: 'var(--mantine-color-gray-light)',
};


