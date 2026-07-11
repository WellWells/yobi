import React, { useEffect, useState } from 'react';
import { Anchor, Box, Button, Container, Divider, Flex, Group, Stack, Text } from '@mantine/core';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { BookOpen, Bug, Book, Download, Info, RefreshCw, Scale, Store } from 'lucide-react';
import { SectionCard } from '../components/SectionCard';
import { GroupHeader } from '../components/GroupHeader';
import styles from './AboutView.module.css';

// Store builds update through Microsoft Store; this deep-links to the Store app on Windows.
const MICROSOFT_STORE_URL = 'https://apps.microsoft.com/detail/9nnx8prfstc9';

// Longest staggered entrance ends at 0.34s delay + 0.5s duration.
const ENTRANCE_ANIMATION_MS = 900;

// Each translated README carries its own "How Yobi Works" section under a
// localized anchor. Locales without a translation fall back to README.md, which
// GitHub renders on the repo root.
const HOW_IT_WORKS_URLS: Record<string, string> = {
  'zh-TW': 'https://github.com/WellWells/yobi/blob/main/README.zh-TW.md#-yobi-如何運作',
  'zh-CN': 'https://github.com/WellWells/yobi/blob/main/README.zh-CN.md#-yobi-如何运作',
  ja: 'https://github.com/WellWells/yobi/blob/main/README.ja.md#-yobi-の仕組み',
};
const HOW_IT_WORKS_FALLBACK = 'https://github.com/WellWells/yobi#-how-yobi-works';

// A colophon, not an attribution list — the authoritative notice for every
// bundled package is THIRD-PARTY-LICENSES.txt (openThirdPartyLicenses).
// A row earns its place only if it names the app's stack or touches the user's
// content, accounts, or credentials; implementation details stay out. Never list
// a dependency that a proprietary-only feature pulls in, or this list forks
// between the official build and the public release.
// `id` resolves the row's description via `about.stack.item.<id>`.
const TECH_STACK: Array<{ id: string; name: string; url: string }> = [
  { id: 'electron', name: 'Electron', url: 'https://www.electronjs.org/' },
  { id: 'react', name: 'React + TypeScript', url: 'https://react.dev/' },
  { id: 'mantine', name: 'Mantine', url: 'https://mantine.dev/' },
  { id: 'zustand', name: 'Zustand', url: 'https://github.com/pmndrs/zustand' },
  { id: 'vite', name: 'Vite', url: 'https://vitejs.dev/' },
  { id: 'reactMarkdown', name: 'react-markdown + Shiki', url: 'https://github.com/remarkjs/react-markdown' },
  { id: 'grammy', name: 'grammY', url: 'https://grammy.dev/' },
  { id: 'lineBotSdk', name: 'LINE Bot SDK', url: 'https://github.com/line/line-bot-sdk-nodejs' },
  { id: 'nodemailer', name: 'Nodemailer', url: 'https://nodemailer.com/' },
  { id: 'cheerio', name: 'cheerio', url: 'https://cheerio.js.org/' },
];

export const AboutView: React.FC = () => {
  const { t, locale } = useI18nStore();
  const [appVersion, setAppVersion] = useState('');
  const [appIconDataUrl, setAppIconDataUrl] = useState('');

  // The view stays mounted and is toggled via `display`, which cancels and then
  // restarts CSS animations. Freeze the entrance stagger after it has played once.
  const isVisible = useAppStore((s) => s.currentView === 'about');
  const [hasEntered, setHasEntered] = useState(false);

  const isChecking = useUpdateStore((s) => s.isChecking);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const checkFailed = useUpdateStore((s) => s.checkFailed);
  const isStoreBuild = useUpdateStore((s) => s.isStoreBuild);
  const newVersion = useUpdateStore((s) => s.newVersion);
  const releaseUrl = useUpdateStore((s) => s.releaseUrl);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const openReleaseUrl = useUpdateStore((s) => s.openReleaseUrl);

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion);
    window.electronAPI.getAppIconDataUrl().then(setAppIconDataUrl).catch(() => { });
  }, []);

  useEffect(() => {
    if (!isVisible || hasEntered) return;
    const timer = window.setTimeout(() => setHasEntered(true), ENTRANCE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible, hasEntered]);

  const isChinese = locale.toLowerCase().includes('zh');
  const blogUrl = isChinese ? 'https://wellstsai.com/' : 'https://wellstsai.com/en/';
  const issueUrl = 'https://github.com/WellWells/yobi/issues';
  const github_repo = 'https://github.com/WellWells/yobi/';
  const howItWorksUrl = encodeURI(HOW_IT_WORKS_URLS[locale] ?? HOW_IT_WORKS_FALLBACK);

  return (
    <Flex
      flex={1}
      bg="var(--mantine-color-body)"
      className={hasEntered ? styles.entered : undefined}
      style={{ overflow: 'hidden' }}
    >
      <Box flex={1} style={{ overflowY: 'auto' }}>
        <Container size={680} py={28} pb={40}>

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
            Yobi
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
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(howItWorksUrl)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<Info size={13} />}
            >
              {t('about.disclosure.title')}
            </Button>
          </Group>
        </Box>

        <Box className={styles.section0} mb={20}>
          <SectionCard>
            <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" lh={1.75}>
              {t('about.desc')}
            </Text>
          </SectionCard>
        </Box>

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

              {isStoreBuild ? (
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap">
                      <Box c="dimmed"><Store size={13} /></Box>
                      <Text fz="var(--font-size-sm)" fw={600}>
                        {t('settings.update.store.status')}
                      </Text>
                    </Group>
                    <Text fz="var(--font-size-xs)" c="dimmed">
                      {t('settings.update.store.hint')}
                    </Text>
                  </Stack>

                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<Store size={13} />}
                    onClick={() => void window.electronAPI.openExternalUrl(MICROSOFT_STORE_URL)}
                    style={{ flexShrink: 0 }}
                  >
                    {t('settings.update.store.button')}
                  </Button>
                </Group>
              ) : (
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
              )}
            </Stack>
          </SectionCard>
        </Box>

        <Box className={styles.section2}>
          <GroupHeader label={t('about.group.stack')} />

          <SectionCard style={{ marginBottom: 12 }}>
            <Text fz="var(--font-size-sm)" c="dimmed" mb={12} lh={1.6}>
              {t('about.stack.intro')}
            </Text>
            {TECH_STACK.map(({ id, name, url }, i, arr) => (
              <Group
                key={id}
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
                <Text fz="var(--font-size-sm)" c="dimmed">{t(`about.stack.item.${id}`)}</Text>
              </Group>
            ))}
            <Flex justify="center" mt={16}>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                leftSection={<Scale size={13} />}
                onClick={() => void window.electronAPI.openThirdPartyLicenses()}
              >
                {t('about.licenses.viewAll')}
              </Button>
            </Flex>
          </SectionCard>
        </Box>

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
