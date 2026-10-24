import { AppWindow, Code, Compass, FolderOpen, Globe, MessageSquare, Workflow, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShortcutGroup } from '../../../../../shared/shortcuts';

export const SHORTCUT_GROUP_ICON: Record<ShortcutGroup, LucideIcon> = {
  global: Globe,
  nav: Compass,
  chat: MessageSquare,
  flow: Workflow,
  files: FolderOpen,
  editor: Code,
  window: AppWindow,
};

export const FLOW_TRIGGERS_ICON: LucideIcon = Zap;
