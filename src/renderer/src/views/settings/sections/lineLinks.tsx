import React from 'react';
import { Anchor } from '@mantine/core';
import { clipboardApi } from '../../../api/electronApi';

export const CLOUDFLARED_DOWNLOAD_URL = 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/';
export const CLOUDFLARE_TUNNEL_GUIDE_URL = 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/';
export const LINE_DEVELOPERS_CONSOLE_URL = 'https://developers.line.biz/console/';
export const LINE_OA_MANAGER_URL = 'https://manager.line.biz/';

export const ExternalLink: React.FC<{ url: string; label: string }> = ({ url, label }) => (
  <Anchor
    fz="var(--font-size-sm)"
    onClick={(event) => {
      event.preventDefault();
      void clipboardApi.openExternalUrl(url);
    }}
    href={url}
  >
    {label}
  </Anchor>
);
