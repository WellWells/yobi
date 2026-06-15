import React from 'react';
import {
  Terminal, Globe, MessageSquare, Clipboard, Timer, Bell, Camera, Bot, Rss, OctagonX, StickyNote, Eye, Repeat, CircleDot, Split, Cpu, Webhook, MonitorPlay, ListVideo, Rocket, Braces, Power, RotateCcw, AppWindow, SquareCode, SquareX, FilePen, FileText, FolderOpen, Mail, Trash2, Type, TrendingUp, DollarSign, Cloud, Download, Dices, LogOut, SkipForward,
} from 'lucide-react';
import type { SkillType } from '../../../../../shared/types';
import type { SkillConfigProps, SkillConfigEditorMap } from './types';
import { ShellConfig } from './ShellConfig';
import { RunConfig } from './RunConfig';
import { BrowserConfig } from './BrowserConfig';
import { BrowserOpenConfig } from './BrowserOpenConfig';
import { BrowserJsConfig } from './BrowserJsConfig';
import { BrowserCloseConfig } from './BrowserCloseConfig';
import { LlmConfig } from './LlmConfig';
import { ClipboardConfig } from './ClipboardConfig';
import { DelayConfig } from './DelayConfig';
import { NotifyConfig } from './NotifyConfig';
import { ScreenCaptureConfig } from './ScreenCaptureConfig';
import { BotConfig } from './BotConfig';
import { RssConfig } from './RssConfig';
import { StopConfig } from './StopConfig';
import { CommentConfig } from './CommentConfig';
import { ScraperConfig } from './ScraperConfig';
import { LoopConfig } from './LoopConfig';
import { IfConfig } from './IfConfig';
import { SysInfoConfig } from './SysInfoConfig';
import { HttpConfig } from './HttpConfig';
import { YoutubeConfig } from './YoutubeConfig';
import { YoutubeSubsConfig } from './YoutubeSubsConfig';
import { JsConfig } from './JsConfig';
import { PowerConfig } from './PowerConfig';
import { FileWriteConfig } from './FileWriteConfig';
import { FileReadConfig } from './FileReadConfig';
import { FileListConfig } from './FileListConfig';
import { FileDeleteConfig } from './FileDeleteConfig';
import { EmailSendConfig } from './EmailSendConfig';
import { TextConfig } from './TextConfig';
import { StockConfig } from './StockConfig';
import { ForexConfig } from './ForexConfig';
import { WeatherConfig } from './WeatherConfig';
import { FileDownloadConfig } from './FileDownloadConfig';
import { RandomConfig } from './RandomConfig';
import { SKILL_CATEGORY, DANGER_SKILLS, type SkillCategoryKey } from '../skillCatalog';

const NoConfig: React.FC<SkillConfigProps> = () => null;

export const STEP_CONFIG_EDITOR: SkillConfigEditorMap = {
  shell: ShellConfig,
  run: RunConfig,
  js: JsConfig,
  browser: BrowserConfig,
  browser_open: BrowserOpenConfig,
  browser_js: BrowserJsConfig,
  browser_close: BrowserCloseConfig,
  llm: LlmConfig,
  clipboard: ClipboardConfig,
  delay: DelayConfig,
  notify: NotifyConfig,
  capture: ScreenCaptureConfig,
  bot: BotConfig,
  rss: RssConfig,
  stop: StopConfig,
  comment: CommentConfig,
  scraper: ScraperConfig,
  loop: LoopConfig,
  end_loop: NoConfig,
  if: IfConfig,
  end_if: NoConfig,
  break: NoConfig,
  continue: NoConfig,
  sysinfo: SysInfoConfig,
  http: HttpConfig,
  youtube: YoutubeConfig,
  youtube_subs: YoutubeSubsConfig,
  power: PowerConfig,
  restart_app: NoConfig,
  file_write: FileWriteConfig,
  file_read: FileReadConfig,
  file_list: FileListConfig,
  file_delete: FileDeleteConfig,
  file_download: FileDownloadConfig,
  email_send: EmailSendConfig,
  text: TextConfig,
  stock: StockConfig,
  forex: ForexConfig,
  weather: WeatherConfig,
  random: RandomConfig,
};

export const SKILL_ICON: Record<SkillType, React.ReactNode> = {
  shell: <Terminal size={14} />,
  run: <Rocket size={14} />,
  js: <Braces size={14} />,
  browser: <Globe size={14} />,
  browser_open: <AppWindow size={14} />,
  browser_js: <SquareCode size={14} />,
  browser_close: <SquareX size={14} />,
  llm: <MessageSquare size={14} />,
  clipboard: <Clipboard size={14} />,
  delay: <Timer size={14} />,
  notify: <Bell size={14} />,
  capture: <Camera size={14} />,
  bot: <Bot size={14} />,
  rss: <Rss size={14} />,
  stop: <OctagonX size={14} />,
  comment: <StickyNote size={14} />,
  scraper: <Eye size={14} />,
  loop: <Repeat size={14} />,
  end_loop: <CircleDot size={14} />,
  if: <Split size={14} />,
  end_if: <CircleDot size={14} />,
  break: <LogOut size={14} />,
  continue: <SkipForward size={14} />,
  sysinfo: <Cpu size={14} />,
  http: <Webhook size={14} />,
  youtube: <MonitorPlay size={14} />,
  youtube_subs: <ListVideo size={14} />,
  power: <Power size={14} />,
  restart_app: <RotateCcw size={14} />,
  file_write: <FilePen size={14} />,
  file_read: <FileText size={14} />,
  file_list: <FolderOpen size={14} />,
  file_delete: <Trash2 size={14} />,
  file_download: <Download size={14} />,
  email_send: <Mail size={14} />,
  text: <Type size={14} />,
  stock: <TrendingUp size={14} />,
  forex: <DollarSign size={14} />,
  weather: <Cloud size={14} />,
  random: <Dices size={14} />,
};

export const CATEGORY_HUE: Record<SkillCategoryKey, string> = {
  extraction: 'cyan',
  browser: 'blue',
  control: 'violet',
  actions: 'green',
  tools: 'gray',
};

export function isDangerSkill(type: SkillType): boolean {
  return DANGER_SKILLS.includes(type);
}

export function skillHue(type: SkillType): string {
  return isDangerSkill(type) ? 'red' : CATEGORY_HUE[SKILL_CATEGORY[type]];
}


