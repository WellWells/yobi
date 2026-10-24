import React, { useEffect, useState } from 'react';
import { Box, Button, Container, Divider, Flex, Group, Stack, Text } from '@mantine/core';
import { useI18nStore } from '../store/i18nStore';
import { updateStatus, useUpdateStore } from '../store/useUpdateStore';
import { Bug, Download, Info, Newspaper, RefreshCw, Scale, Store } from 'lucide-react';
import { GithubIcon } from '../config/brandIcons';
import { SectionCard } from '../components/SectionCard';
import { GroupHeader } from '../components/GroupHeader';
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL, howItWorksUrl } from '../config/projectLinks';
import styles from './AboutView.module.css';
import { fillTemplate } from '../../../shared/fillTemplate';

const MICROSOFT_STORE_URL = 'https://apps.microsoft.com/detail/9nnx8prfstc9';

export const AboutView: React.FC = () => {
  const { t, locale } = useI18nStore();
  const [appVersion, setAppVersion] = useState('');
  const [appIconDataUrl, setAppIconDataUrl] = useState('');

  const status = useUpdateStore(updateStatus);
  const isStoreBuild = useUpdateStore((s) => s.isStoreBuild);
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

  const statusTitle = {
    available: fillTemplate(t('settings.update.available'), { version: newVersion ?? '' }),
    checking: t('settings.update.checking'),
    failed: t('settings.update.checkFailed'),
    latest: t('settings.update.latest'),
    unchecked: t('settings.update.notChecked'),
  }[status];

  return (
    <Flex flex={1} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
      <Box flex={1} style={{ overflowY: 'auto' }}>
        <Container size={680} py={28} pb={40}>

        <Box className={styles.hero}>
          {appIconDataUrl && (
            <Box className={styles.heroIconWrapper}>
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
              leftSection={<Newspaper size={13} />}
            >
              {t('about.blog')}
            </Button>
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(GITHUB_REPO_URL)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<GithubIcon size={13} />}
            >
              {t('about.github')}
            </Button>
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(GITHUB_ISSUES_URL)}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<Bug size={13} />}
            >
              {t('about.reportIssue')}
            </Button>
            <Button
              onClick={() => void window.electronAPI.openExternalUrl(howItWorksUrl(locale))}
              variant="outline"
              size="xs"
              radius="md"
              leftSection={<Info size={13} />}
            >
              {t('about.disclosure.title')}
            </Button>
          </Group>
        </Box>

        <Box mb={20}>
          <SectionCard>
            <Text fz="var(--font-size-base)" c="var(--mantine-color-default-color)" lh={1.75}>
              {t('about.desc')}
            </Text>
          </SectionCard>
        </Box>

        <Box>
          <GroupHeader label={t('about.group.update')} />

          <SectionCard style={{ marginBottom: 12 }}>
            {isStoreBuild ? (
              <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Box c="dimmed"><Store size={13} /></Box>
                  <Text fz="var(--font-size-sm)" fw={600}>
                    {t('settings.update.store.status')}
                  </Text>
                </Group>

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
                    <Box c={status === 'failed' ? 'var(--mantine-color-error)' : status === 'available' ? 'var(--mantine-color-accent)' : 'dimmed'}>
                      <RefreshCw
                        size={13}
                        className={status === 'checking' ? styles.spinning : undefined}
                      />
                    </Box>
                    <Text fz="var(--font-size-sm)" fw={600} c={status === 'failed' ? 'var(--mantine-color-error)' : undefined}>
                      {statusTitle}
                    </Text>
                  </Group>
                  {status === 'failed' && (
                    <Text fz="var(--font-size-xs)" c="dimmed">
                      {t('settings.update.hint.failed')}
                    </Text>
                  )}
                </Stack>

                {status === 'available' ? (
                  <Button
                    size="xs"
                    variant="filled"
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
                    disabled={status === 'checking'}
                    style={{ flexShrink: 0 }}
                  >
                    {t('settings.update.check')}
                  </Button>
                )}
              </Group>
            )}
          </SectionCard>
        </Box>

        <Box>
          <Divider mt={8} mb={16} />
          <Stack gap={6} align="center">
            <Text fz="var(--font-size-sm)" c="dimmed">
              Copyright © 2026 WellsTsai. Licensed under the MIT License.
            </Text>
            <Button
              variant="subtle"
              color="gray"
              size="xs"
              leftSection={<Scale size={13} />}
              onClick={() => void window.electronAPI.openThirdPartyLicenses()}
            >
              {t('about.licenses.viewAll')}
            </Button>
          </Stack>
        </Box>

        </Container>
      </Box>
    </Flex>
  );
};
