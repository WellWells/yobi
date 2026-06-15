import React from 'react';
import { Minus, Plus, X } from 'lucide-react';

export const noDrag: React.CSSProperties = { WebkitAppRegion: 'no-drag' };
const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
export const isMac = (navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase().includes('mac');

export const titleBarDynStyle: React.CSSProperties = {
  padding: isMac ? '0 10px' : '0 0 0 10px',
  WebkitAppRegion: 'drag' as React.CSSProperties['WebkitAppRegion'],
};

export const macInactiveColor = 'rgba(140, 140, 140, 0.45)';
export const navScrollStyle: React.CSSProperties = {
  ...noDrag,
  minWidth: 0,
  flexShrink: 1,
  scrollbarWidth: 'none' as React.CSSProperties['scrollbarWidth'],
};
export const statusWrapperStyle: React.CSSProperties = { ...noDrag, flexShrink: 0 };

export function doWindowAction(action: 'minimize' | 'maximize' | 'close'): void {
  if (action === 'minimize') { window.electronAPI.minimizeWindow(); return; }
  if (action === 'maximize') { window.electronAPI.maximizeWindow(); return; }
  window.electronAPI.closeWindow();
}

export function getWindowActionTitle(t: (k: string) => string, action: 'minimize' | 'maximize' | 'close'): string {
  if (action === 'minimize') return t('window.minimize');
  if (action === 'maximize') return t('window.maximize');
  return t('window.close');
}

export const macWindowButtonDefs: Array<{ action: 'close' | 'minimize' | 'maximize'; color: string; icon: React.ReactNode }> = [
  { action: 'close', color: '#ff5f57', icon: <X size={9} strokeWidth={2.3} /> },
  { action: 'minimize', color: '#febc2e', icon: <Minus size={9} strokeWidth={2.3} /> },
  { action: 'maximize', color: '#28c840', icon: <Plus size={9} strokeWidth={2.3} /> },
];

const windowsMaximizeIcon = (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="1.25" y="1.25" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.2" shapeRendering="crispEdges" />
  </svg>
);

export type WinBtnAction = 'minimize' | 'maximize' | 'close';

export const winButtonDefs: Array<{ action: WinBtnAction }> = [
  { action: 'minimize' },
  { action: 'maximize' },
  { action: 'close' },
];

export const winButtonIcons: Record<WinBtnAction, React.ReactNode> = {
  minimize: <Minus size={14} strokeWidth={2.1} />,
  maximize: windowsMaximizeIcon,
  close: <X size={14} strokeWidth={2.1} />,
};
