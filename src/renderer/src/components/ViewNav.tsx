import React, { useRef } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { MessageSquare, Settings, Workflow } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import type { MainView } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { useSecretHealthStore } from '../store/secretHealthStore';
import { useFlowStore } from '../store/useFlowStore';
import { useFlowIssues } from '../hooks/useFlowIssues';
import { hasAnyFlowIssue } from '../../../shared/flowIssues';
import { AppSegmentedControl } from './AppSegmentedControl';
import { ToolbarIconButton } from './PanelToolbar';
import { SidebarActionRow } from './SidebarActionRow';

/*
 * Moving between the views, as ChatGPT's, Claude's, Gemini's and Perplexity's sidebars do, so the
 * title bar does not list them (there is no title bar band at all, see `TitleBar`): the two views
 * with a sidebar switch at its top (聊天｜流程, as Claude's chat/code switch), Settings is the row at
 * its foot, and Logs and About are pages of Settings. Settings is a dialog over the view it was
 * opened from (`SettingsDialog`), closed by its ✕ or Escape. Alt+1…5 still reach all five.
 */

type AlertTone = 'error' | 'warning';

/**
 * What the 設定 row has to say from inside Chat or Flow, the one cue a user sitting there gets:
 * a secret that no longer decrypts (a dead bot token is breaking things now) outranks an update.
 */
export function useSettingsAlert(): AlertTone | null {
  const secretsBroken = useSecretHealthStore((s) => s.failures.length > 0);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  if (secretsBroken) return 'error';
  return hasUpdate ? 'warning' : null;
}

/** A status dot beside a nav entry's name: no words, so the entry's text stays its name. */
export const AlertDot: React.FC<{ tone: AlertTone }> = ({ tone }) => (
  <Box w={6} h={6} bg={`var(--mantine-color-${tone})`} style={{ borderRadius: '50%', flexShrink: 0 }} aria-hidden />
);

function SwitchLabel({ icon: Icon, label, alert }: { icon: React.ComponentType<{ size?: number }>; label: string; alert?: AlertTone }) {
  return (
    <Group gap={6} justify="center" wrap="nowrap">
      <Icon size={14} />
      <Text component="span" fz="inherit" truncate>{label}</Text>
      {alert && <AlertDot tone={alert} />}
    </Group>
  );
}

/**
 * The 聊天｜流程 switch under a sidebar's top row, above its main action (`SidebarTop`). A flow
 * that would answer nothing (a clashing bot command, an unfilled required setting) marks 流程 while
 * the user sits in Chat.
 */
export const ViewSwitch: React.FC = () => {
  const { currentView, setView } = useAppStore(useShallow((s) => ({ currentView: s.currentView, setView: s.setView })));
  const t = useI18nStore((s) => s.t);
  const flowBroken = hasAnyFlowIssue(useFlowIssues());
  const backToFlowHome = useRef(false);
  const value: MainView = currentView === 'flow' ? 'flow' : 'chat';
  return (
    <Box px={10} pb={8} style={{ flexShrink: 0 }}>
      <AppSegmentedControl
        size="xs"
        quiet
        value={value}
        onChange={(next) => { if (next === 'chat' || next === 'flow') setView(next); }}
        options={[
          { value: 'chat', label: <SwitchLabel icon={MessageSquare} label={t('nav.chat')} /> },
          {
            value: 'flow',
            // Clicking 流程 again from inside the flow page closes the open flow, back to the flow
            // home (as Claude's 排程任務 does). The control fires no change for the chosen segment,
            // so this rides on the label's own click; unsaved edits stay in the store. Which view
            // it was is read at mousedown: by the click, the switch to Flow may already have run.
            label: (
              <Box
                onMouseDown={() => { backToFlowHome.current = useAppStore.getState().currentView === 'flow'; }}
                onClick={() => {
                  if (backToFlowHome.current) useFlowStore.getState().selectFlow(null);
                  backToFlowHome.current = false;
                }}
              >
                <SwitchLabel icon={Workflow} label={t('nav.flow')} alert={flowBroken && value !== 'flow' ? 'warning' : undefined} />
              </Box>
            ),
          },
        ]}
      />
    </Box>
  );
};

/** The row at the foot of the chat and flow sidebars that opens Settings. */
export const SettingsFooter: React.FC = () => {
  const setView = useAppStore((s) => s.setView);
  const t = useI18nStore((s) => s.t);
  const alert = useSettingsAlert();
  return (
    <Box px={10} py={8} style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
      <SidebarActionRow
        icon={Settings}
        label={t('nav.settings')}
        onClick={() => setView('settings')}
        trailing={alert ? <Group px={6}><AlertDot tone={alert} /></Group> : undefined}
      />
    </Box>
  );
};

/**
 * A folded sidebar's way to the other views: the other view with a sidebar (Flow from Chat's rail,
 * Chat from Flow's), then Settings at the rail's foot.
 */
export const RailViewNav: React.FC<{ to?: 'chat' | 'flow' }> = ({ to = 'flow' }) => {
  const setView = useAppStore((s) => s.setView);
  const t = useI18nStore((s) => s.t);
  const alert = useSettingsAlert();
  return (
    <Stack gap={6} align="center" py={8} style={{ flexShrink: 0 }}>
      {/* The flows' own mark, the one their slash commands wear (FLOW_COMMAND_ICON); the switch's
          chat mark for the way back to Chat. */}
      {to === 'flow'
        ? <ToolbarIconButton icon={Workflow} label={t('nav.flow')} onClick={() => setView('flow')} />
        : <ToolbarIconButton icon={MessageSquare} label={t('nav.chat')} onClick={() => setView('chat')} />}
      <Box pos="relative">
        <ToolbarIconButton icon={Settings} label={t('nav.settings')} onClick={() => setView('settings')} />
        {alert && (
          <Box pos="absolute" top={5} right={5} style={{ pointerEvents: 'none' }}>
            <AlertDot tone={alert} />
          </Box>
        )}
      </Box>
    </Stack>
  );
};
