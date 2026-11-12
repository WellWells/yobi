import React from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { Info, LogIn } from 'lucide-react';
import { useSiteAccountStatus } from '../../../hooks/useSiteAccountStatus';
import { useAppStore } from '../../../store/appStore';
import { SITE_ACCOUNT_LABELS } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

/** The post sites whose sign-in in Settings changes what a post read gets. */
export type PostSignInSite = 'x' | 'threads' | 'instagram' | 'facebook';

interface Props {
  /** Which limit applies on X: the newest few posts per account, the top few replies per post, or no trends at all. */
  limit: 'posts' | 'replies' | 'trends';
  /** The site the step reads; X unless a post link says otherwise. */
  site?: PostSignInSite;
  t: (key: string) => string;
}

/** What signing in to the site changes for this step, with a way to the sign-in in Settings. */
export const XSignInNotice: React.FC<Props> = ({ limit, site = 'x', t }) => {
  const loggedIn = useSiteAccountStatus(site);
  const name = SITE_ACCOUNT_LABELS[site];

  if (loggedIn === null) return null;
  if (loggedIn) {
    const text = site === 'x' ? t('flow.skill.x.signedIn') : fillTemplate(t('flow.skill.x.signedIn.site'), { site: name });
    return <Text fz="xs" c="var(--text-muted)">{text}</Text>;
  }
  return (
    <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
      <Stack gap={6}>
        <Text fz="xs" style={{ lineHeight: 1.6 }}>
          {site === 'x' ? t(`flow.skill.x.signedOut.${limit}`) : t(`flow.skill.x.signedOut.${site}`)}
        </Text>
        <Button
          variant="light"
          color="var(--mantine-color-warning)"
          size="compact-xs"
          leftSection={<LogIn size={12} />}
          onClick={() => useAppStore.getState().openSettingsCategory('connectors')}
          style={{ alignSelf: 'flex-start' }}
        >
          {site === 'x' ? t('flow.skill.x.signIn') : fillTemplate(t('flow.skill.x.signIn.site'), { site: name })}
        </Button>
      </Stack>
    </Alert>
  );
};
