import React from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { Info, LogIn } from 'lucide-react';
import { useSiteAccountStatus } from '../../../hooks/useSiteAccountStatus';
import { useAppStore } from '../../../store/appStore';

interface Props {
  /** Which limit applies: the newest few posts per account, the top few replies per post, or no trends at all. */
  limit: 'posts' | 'replies' | 'trends';
  t: (key: string) => string;
}

/** What signing in to X changes for this step, with a way to the sign-in in Settings. */
export const XSignInNotice: React.FC<Props> = ({ limit, t }) => {
  const loggedIn = useSiteAccountStatus('x');

  if (loggedIn === null) return null;
  if (loggedIn) {
    return <Text fz="xs" c="dimmed">{t('flow.skill.x.signedIn')}</Text>;
  }
  return (
    <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
      <Stack gap={6}>
        <Text fz="xs" style={{ lineHeight: 1.6 }}>{t(`flow.skill.x.signedOut.${limit}`)}</Text>
        <Button
          variant="light"
          color="var(--mantine-color-warning)"
          size="compact-xs"
          leftSection={<LogIn size={12} />}
          onClick={() => useAppStore.getState().openSettingsCategory('connectors')}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('flow.skill.x.signIn')}
        </Button>
      </Stack>
    </Alert>
  );
};
