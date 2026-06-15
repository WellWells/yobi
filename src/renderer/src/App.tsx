import React, { useCallback, useEffect, useState } from 'react';
import { AppWindow, LogOut } from 'lucide-react';
import { Modal, Button, Group, Text, Checkbox, Box, Flex, Stack, Loader } from '@mantine/core';
import { TitleBar } from './components/TitleBar';
import { ChatView } from './views/ChatView';
import { SettingsView } from './views/SettingsView';
import { AboutView } from './views/AboutView';
import { LogView } from './views/LogView';
import { AgentFlowView } from './views/AgentFlowView';

const MemoSettingsView = React.memo(SettingsView);
const MemoAboutView = React.memo(AboutView);
const MemoLogView = React.memo(LogView);
const MemoAgentFlowView = React.memo(AgentFlowView);
import { useAppStore } from './store/appStore';
import { useI18nStore } from './store/i18nStore';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { ipcEvents, windowApi } from './api/electronApi';

export const App: React.FC = () => {
  const currentView = useAppStore((s) => s.currentView);
  const { isReady, t } = useI18nStore();
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [closeRemember, setCloseRemember] = useState(false);

  useAppBootstrap();

  const handleCloseDialogRespond = useCallback((action: 'quit' | 'hide') => {
    setShowCloseDialog(false);
    windowApi.respondCloseDialog(action, closeRemember);
  }, [closeRemember]);

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
          <MemoLogView />
        </Box>
        <Box display={currentView === 'settings' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <MemoSettingsView />
        </Box>
        <Box display={currentView === 'about' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <MemoAboutView />
        </Box>
        <Box display={currentView === 'agentflow' ? 'flex' : 'none'} flex={1} style={{ overflow: 'hidden' }}>
          <MemoAgentFlowView />
        </Box>
      </Flex>

      <Modal
        opened={showCloseDialog}
        onClose={() => { }}
        withCloseButton={false}
        centered
        size="sm"
        zIndex={100}
        overlayProps={{ backgroundOpacity: 0.55 }}
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

