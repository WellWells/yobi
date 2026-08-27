import { Clock, Eye, Server, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShareConsentKey } from '../../../shared/types';

export const SHARE_CONSENT_ICONS: Record<ShareConsentKey, LucideIcon> = {
  'share.consent.thirdParty': Server,
  'share.consent.encrypted': ShieldCheck,
  'share.consent.anyoneWithLink': Eye,
  'share.consent.expires': Clock,
  'share.consent.browserCeiling': TriangleAlert,
};
