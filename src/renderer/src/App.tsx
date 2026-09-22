import React, { useCallback, useEffect, useState } from 'react';
import { AppWindow, LogOut } from 'lucide-react';
import { Modal, Button, Group, Text, Checkbox, Box, Flex, Stack, Loader } from '@mantine/core';
import { TitleBar } from './components/TitleBar';
import { AgentConfirmDialog } from './components/AgentConfirmDialog';
import { ViewBoundary } from './components/ViewBoundary';
import { ChatView } from './views/ChatView';
import { onIdle } from './utils/idle';
import { useAppStore } from './store/appStore';
import { useI18nStore } from './store/i18nStore';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { useUiNotifications } from './hooks/useUiNotifications';
import { useShortcutDispatcher } from './shortcuts/useShortcutDispatcher';
import { ipcEvents, windowApi } from './api/electronApi';

// The app always opens on the chat view, so it is the only one worth putting on
// the first-paint path. The other four — settings with its dozen sections, the
// flow editor, dnd-kit, react-virtual — used to sit in the entry chunk purely to
// be hidden by `display: none`. They are pulled in on idle once i18n is ready,
// early enough that switching views finds them in memory, and once resolved they
// stay mounted for good, which is what the display-toggle lifecycle below needs.
const importSettingsView = () => import('./views/SettingsView');
const importAboutView = () => import('./views/AboutView');
const importLogView = () => import('./views/LogView');
const importFlowView = () => import('./views/FlowView');

const MemoSettingsView = React.memo(React.lazy(() => importSettingsView().then((m) => ({ default: m.SettingsView }))));
const MemoAboutView = React.memo(React.lazy(() => importAboutView().then((m) => ({ default: m.AboutView }))));
const MemoLogView = React.memo(React.lazy(() => importLogView().then((m) => ({ default: m.LogView }))));
const MemoFlowView = React.memo(React.lazy(() => importFlowView().then((m) => ({ default: m.FlowView }))));

export const App: React.FC = () => {
  const currentView = useAppStore((s) => s.currentView);
  const { isReady, t } = useI18nStore();
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
      void importAboutView();
      void importLogView();
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

  if (!isReady) {
    return (
      <Flex direction="column" h="100vh" bg="var(--mantine-color-body)" align="center" justify="center" style={{ overflow: 'hidden' }}>
        <Stack align="center" gap={16}>
          <Loader size="md" color="var(--mantine-color-accent)" />
          <Text fz="var(--font-size-md)" c="dimmed">Loading...</Text>
        </Stack>
      </Flex>
    );
  }

  return (
    <Flex direction="column" h="100vh" bg="var(--mantine-color-body)" pos="relative" style={{ overflow: 'hidden' }}>
      <TitleBar />
      <Flex flex={1} style={{ overflow: 'hidden' }}>
        <Box display={currentView === 'chat' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ChatView />
        </Box>
        <Box display={currentView === 'logs' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ViewBoundary><MemoLogView /></ViewBoundary>
        </Box>
        <Box display={currentView === 'settings' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ViewBoundary><MemoSettingsView /></ViewBoundary>
        </Box>
        <Box display={currentView === 'about' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ViewBoundary><MemoAboutView /></ViewBoundary>
        </Box>
        <Box display={currentView === 'flow' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <ViewBoundary><MemoFlowView /></ViewBoundary>
        </Box>
      </Flex>

      <AgentConfirmDialog />

      <Modal
        opened={showCloseDialog}
        onClose={() => { }}
        withCloseButton={false}
        centered
        size="sm"
        zIndex={100}
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
  );
};

