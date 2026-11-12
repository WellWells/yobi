import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, LogOut } from 'lucide-react';
import { Modal, Button, Group, Text, Checkbox, Box, Flex, Loader } from '@mantine/core';
import { TitleBar } from './components/TitleBar';
import { AgentConfirmDialog } from './components/AgentConfirmDialog';
import { TextContextMenu } from './components/textContextMenu/TextContextMenu';
import { ViewBoundary } from './components/ViewBoundary';
import { ChatView } from './views/ChatView';
import { onIdle } from './utils/idle';
import { useShallow } from 'zustand/react/shallow';
import { SettingsDialog } from './components/SettingsDialog';
import { Z_MODAL_CONFIRM } from './config/zLayers';
import { drawnView, isMainView, useAppStore } from './store/appStore';
import { useI18nStore } from './store/i18nStore';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useUiNotifications } from './hooks/useUiNotifications';
import { useShortcutDispatcher } from './shortcuts/useShortcutDispatcher';
import { ipcEvents, windowApi } from './api/electronApi';
import { MarkdownLabelsContext } from './utils/markdownConfig';
import { buildMarkdownLabels } from '../../shared/markdownLabels';

// Only the chat view is on the first-paint path. The other views are lazy chunks prefetched on idle
// once i18n is ready, and stay mounted once resolved, as the display-toggle lifecycle below needs.
// Logs and About are pages of Settings and ride in its chunk; Settings is a dialog, kept mounted.
const importSettingsView = () => import('./views/SettingsView');
const importFlowView = () => import('./views/FlowView');

const MemoSettingsView = React.memo(React.lazy(() => importSettingsView().then((m) => ({ default: m.SettingsView }))));
const MemoFlowView = React.memo(React.lazy(() => importFlowView().then((m) => ({ default: m.FlowView }))));

export const App: React.FC = () => {
  const { shown, settingsOpen, closeSettings } = useAppStore(useShallow((s) => ({
    shown: drawnView(s),
    settingsOpen: !isMainView(s.currentView),
    closeSettings: s.closeSettings,
  })));
  const { isReady, t } = useI18nStore(useShallow((s) => ({ isReady: s.isReady, t: s.t })));
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeRemember, setCloseRemember] = useState(false);

  useAppBootstrap();
  useShortcutDispatcher();
  useUiNotifications();

  const handleCloseDialogRespond = useCallback((action: 'quit' | 'hide') => {
    setShowCloseDialog(false);
    windowApi.respondCloseDialog(action, closeRemember);
  }, [closeRemember]);

  useEffect(() => {
    if (!isReady) return;
    return onIdle(() => {
      void importSettingsView();
      void importFlowView();
    });
  }, [isReady]);

  useEffect(() => {
    const unsub = ipcEvents.onShowCloseDialog(() => {
      setCloseRemember(false);
      setShowCloseDialog(true);
    });
    return unsub;
  }, []);

  const markdownLabels = useMemo(() => buildMarkdownLabels(t), [t]);

  // No words here: the language packs are what this gate is waiting for.
  if (!isReady) {
    return (
      <Flex direction="column" h="100vh" bg="var(--mantine-color-body)" align="center" justify="center" style={{ overflow: 'hidden' }}>
        <Loader size="md" color="var(--mantine-color-accent)" />
      </Flex>
    );
  }

  return (
    <MarkdownLabelsContext.Provider value={markdownLabels}>
    <Flex direction="column" h="100vh" bg="var(--mantine-color-body)" pos="relative" style={{ overflow: 'hidden' }}>
      <Flex flex={1} style={{ overflow: 'hidden' }}>
        <Box display={shown === 'chat' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ChatView />
        </Box>
        <Box display={shown === 'flow' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ViewBoundary><MemoFlowView /></ViewBoundary>
        </Box>
      </Flex>

      <TitleBar />

      {/* Settings, Logs and About: a dialog over the view above, which stays drawn behind it. */}
      <SettingsDialog opened={settingsOpen} onClose={closeSettings}>
        <ViewBoundary><MemoSettingsView /></ViewBoundary>
      </SettingsDialog>

      <AgentConfirmDialog />

      {/* Cut / Copy / Paste in every text field: Electron draws no context menu of its own. */}
      <TextContextMenu />

      {/* Asked when the window's ✕ is clicked, which stays clickable over the Settings dialog
          (and Alt+F4 reaches it over any dialog): over every dialog, never behind one. */}
      <Modal
        opened={showCloseDialog}
        onClose={() => { }}
        withCloseButton={false}
        centered
        size="sm"
        zIndex={Z_MODAL_CONFIRM}
        styles={{
          content: {
            background: 'var(--mantine-color-default)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--radius-lg)',
          },
          body: { background: 'var(--mantine-color-default)' },
        }}
      >
        <Text fw={700} fz="var(--font-size-md)" mb={6}>
          {t('tray.closeDialog.message')}
        </Text>
        <Text fz="var(--font-size-xs)" c="dimmed" mb={18} lh={1.6}>
          {t('tray.closeDialog.detail')}
        </Text>

        <Group gap={8} mb={8} grow>
          <Button
            variant="default"
            size="md"
            onClick={() => handleCloseDialogRespond('hide')}
            autoFocus
            leftSection={<AppWindow size={15} />}
            styles={{
              root: { height: 'auto', padding: '11px 14px' },
              inner: { justifyContent: 'flex-start' },
              label: { textAlign: 'left' },
            }}
          >
            <Box>
              <Box>{t('tray.closeDialog.hide')}</Box>
              <Text fz="var(--font-size-xs)" fw={400} opacity={0.8} mt={2}>
                {t('tray.closeDialog.hideHint')}
              </Text>
            </Box>
          </Button>
        </Group>

        <Group gap={8} mb={16} grow>
          <Button
            variant="default"
            color="red"
            size="md"
            onClick={() => handleCloseDialogRespond('quit')}
            leftSection={<LogOut size={15} />}
            styles={{
              root: { height: 'auto', padding: '11px 14px' },
              inner: { justifyContent: 'flex-start' },
              label: { textAlign: 'left' },
            }}
          >
            <Box>
              <Box>{t('tray.closeDialog.quit')}</Box>
              <Text fz="var(--font-size-xs)" fw={400} opacity={0.8} mt={2}>
                {t('tray.closeDialog.quitHint')}
              </Text>
            </Box>
          </Button>
        </Group>

        <Checkbox
          checked={closeRemember}
          onChange={(e) => setCloseRemember(e.currentTarget.checked)}
          label={t('tray.closeDialog.remember')}
          size="sm"
          styles={{
            label: { color: 'var(--mantine-color-dimmed)', fontSize: 'var(--font-size-xs)' },
          }}
        />
      </Modal>
    </Flex>
    </MarkdownLabelsContext.Provider>
  );
};

