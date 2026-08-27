import React from 'react';
import { Alert, Stack, Text } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { ExternalLink, LINE_DEVELOPERS_CONSOLE_URL, LINE_OA_MANAGER_URL } from './lineLinks';

import type { LineAccountInfo } from '../../../../../shared/types';

interface Props {
  account?: LineAccountInfo;
  t: (key: string) => string;
}

export const LineAccountAlerts: React.FC<Props> = ({ account, t }) => {
  if (!account) return null;
  const showChatMode = account.chatModeOn;
  const showWebhook = account.webhookActive === false;
  if (!showChatMode && !showWebhook) return null;

  return (
    <Stack gap={8}>
      {showChatMode && (
        <Alert color="yellow" icon={<TriangleAlert size={16} />} title={t('settings.line.account.chatModeTitle')}>
          <Text fz="var(--font-size-sm)" lh={1.6}>{t('settings.line.account.chatModeBody')}</Text>
          <ExternalLink url={LINE_OA_MANAGER_URL} label={t('settings.line.account.openOaManager')} />
        </Alert>
      )}
      {showWebhook && (
        <Alert color="yellow" icon={<TriangleAlert size={16} />} title={t('settings.line.account.webhookOffTitle')}>
          <Text fz="var(--font-size-sm)" lh={1.6}>{t('settings.line.account.webhookOffBody')}</Text>
          <ExternalLink url={LINE_DEVELOPERS_CONSOLE_URL} label={t('settings.line.account.openConsole')} />
        </Alert>
      )}
    </Stack>
  );
};
