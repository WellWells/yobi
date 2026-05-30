// src/renderer/src/views/AboutView.tsx
import React, { useEffect, useState } from 'react';
import { Anchor, Box, Button, Container, Divider, Flex, Group, Stack, Text } from '@mantine/core';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { BookOpen, Bug, Book, Download, Info, RefreshCw } from 'lucide-react';
import { SectionCard } from '../components/SectionCard';
import { GroupHeader } from '../components/GroupHeader';
import styles from './AboutView.module.css';

const TECH_STACK: Array<{ name: string; url: string; desc: string }> = [
  { name: 'Electron', url: 'https://www.electronjs.org/', desc: 'Desktop runtime' },
  { name: 'React + TypeScript', url: 'https://react.dev/', desc: 'UI renderer' },
  { name: 'Vite', url: 'https://vitejs.dev/', desc: 'Build tool' },
  { name: 'Mantine', url: 'https://mantine.dev/', desc: 'UI component library' },
  { name: 'Zustand', url: 'https://github.com/pmndrs/zustand', desc: 'State management' },
  { name: 'grammY', url: 'https://grammy.dev/', desc: 'Telegram Bot API framework' },
  { name: 'react-markdown + Shiki', url: 'https://github.com/remarkjs/react-markdown', desc: 'Markdown & Syntax highlighting' },
  { name: 'KaTeX', url: 'https://katex.org/', desc: 'Math typesetting' },
];

export const AboutView: React.FC = () => {
  const { t, locale } = useI18nStore();
  const [appVersion, setAppVersion] = useState('');
  const [appIconDataUrl, setAppIconDataUrl] = useState('');

  const isChecking = useUpdateStore((s) => s.isChecking);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const checkFailed = useUpdateStore((s) => s.checkFailed);
  const newVersion = useUpdateStore((s) => s.newVersion);
  const releaseUrl = useUpdateStore((s) => s.releaseUrl);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openReleaseUrl = useUpdateStore((s) => s.openReleaseUrl);

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion);
    window.electronAPI.getAppIconDataUrl().then(setAppIconDataUrl).catch(() => { });
  }, []);

  const isChinese = locale.toLowerCase().includes('zh');
  const blogUrl = isChinese ? 'https://wellstsai.com/' : 'https://wellstsai.com/en/';
  const issueUrl = 'https://github.com/WellWells/desktop-agent-center/issues';
  const github_repo = 'https://github.com/WellWells/desktop-agent-center/';

  return (
    <Flex flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
      <Box flex={1} style={{ overflowY: 'auto' }}>
        <Container size={680} py={28} pb={40}>

        {/* ═══ Hero ═══════════════════════════════════════════════════════ */}
        <Box className={styles.hero}>
          {appIconDataUrl && (
            <Box className={styles.heroIconWrapper}>
              <Box className={styles.heroIconGlow} />
              <Box
                component="img"
                src={appIconDataUrl}
                alt="App icon"
                draggable={false}
                aria-hidden="true"
                className={styles.heroIconImg}
              />
            </Box>
          )}
          <Text component="h1" className={styles.heroTitle}>
            Desktop Agent Center
          </Text>
          <Text component="span" className={styles.heroVersion}>
            {appVersion ? `v${appVersion}` : '...'}
          </Text>
          <Group gap={8} justify="center" mt="lg">
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(blogUrl)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<BookOpen size={13} />}
            >
              {t('about.blog')}
            </Button>
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(github_repo)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<Book size={13} />}
            >
              {t('about.github')}
            </Button>
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(issueUrl)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<Bug size={13} />}
            >
              {t('about.reportIssue')}
            </Button>
          </Group>
        </Box>

        {/* ═══ Description ════════════════════════════════════════════════ */}
        <Box className={styles.section0} mb={20}>
          <SectionCard>
            <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" lh={1.75}>
              {t('about.desc')}
            </Text>
          </SectionCard>
        </Box>

        {/* ═══ Group: Software Update ═════════════════════════════════════ */}
        <Box className={styles.section1}>
          <GroupHeader label={t('about.group.update')} />

          <SectionCard style={{ marginBottom: 12 }}>
            <Stack gap={10}>
              <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Box c="dimmed"><Info size={13} /></Box>
                  <Text fz="var(--font-size-sm)" fw={600}>{t('settings.update.currentVersion')}</Text>
                </Group>
                <Text fz="var(--font-size-sm)" ff="var(--font-mono)" c="dimmed">
                  {appVersion ? `v${appVersion}` : '...'}
                </Text>
              </Group>

              <Group justify="space-between" align="center" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Box c={checkFailed ? 'var(--mantine-color-error)' : hasUpdate ? 'var(--mantine-color-blue-5)' : 'dimmed'}>
                      <RefreshCw
                        size={13}
                        className={isChecking ? styles.spinning : undefined}
                      />
                    </Box>
                    <Text fz="var(--font-size-sm)" fw={600}
                      c={checkFailed ? 'var(--mantine-color-error)' : hasUpdate ? 'var(--mantine-color-blue-5)' : undefined}
                    >
                      {hasUpdate && newVersion
                        ? t('settings.update.available').replace('{{version}}', newVersion)
                        : checkFailed
                          ? t('settings.update.checkFailed')
                          : t('settings.update.latest')}
                    </Text>
                  </Group>
                  <Text fz="var(--font-size-xs)" c="dimmed">
                    {hasUpdate
                      ? t('settings.update.hint.available')
                      : checkFailed
                        ? t('settings.update.hint.failed')
                        : t('settings.update.hint.latest')}
                  </Text>
                </Stack>

                {hasUpdate ? (
                  <Button
                    size="xs"
                    variant="filled"
                    color="blue"
                    leftSection={<Download size={13} />}
                    onClick={() => { void openReleaseUrl(); }}
                    disabled={!releaseUrl}
                    style={{ flexShrink: 0 }}
                  >
                    {t('settings.update.download')}
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<RefreshCw size={13} />}
                    onClick={() => { void checkForUpdates(); }}
                    disabled={isChecking}
                    style={{ flexShrink: 0 }}
                  >
                    {isChecking ? t('settings.update.checking') : t('settings.update.check')}
                  </Button>
                )}
              </Group>
            </Stack>
          </SectionCard>
        </Box>

        {/* ═══ Group: Open Source Software ════════════════════════════════ */}
        <Box className={styles.section2}>
          <GroupHeader label={t('about.group.stack')} />

          <SectionCard style={{ marginBottom: 12 }}>
            <Text fz="var(--font-size-sm)" c="dimmed" mb={12} lh={1.6}>
              {t('about.stack.intro')}
            </Text>
            {TECH_STACK.map(({ name, url, desc }, i, arr) => (
              <Group
                key={name}
                justify="space-between"
                align="center"
                gap={8}
                py={5}
                className={styles.techRow}
                style={{
                  borderBottom: i < arr.length - 1 ? '1px solid var(--mantine-color-default-border)' : 'none',
                }}
              >
                <Anchor
                  component="button"
                  onClick={() => void window.electronAPI.openExternalUrl(url)}
                  fz="var(--font-size-base)"
                  ff="var(--font-mono)"
                  c="var(--mantine-color-accent)"
                >
                  {name}
                </Anchor>
                <Text fz="var(--font-size-sm)" c="dimmed">{desc}</Text>
              </Group>
            ))}
          </SectionCard>
        </Box>

        {/* ═══ Copyright ═══════════════════════════════════════════════════ */}
        <Box className={styles.section3}>
          <Divider mt={8} mb={16} />
          <Flex justify="center">
            <Text fz="var(--font-size-sm)" c="dimmed">
              Copyright © 2026 WellsTsai. Licensed under the MIT License.
            </Text>
          </Flex>
        </Box>

        </Container>
      </Box>
    </Flex>
  );
};
