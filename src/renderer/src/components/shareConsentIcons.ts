import { Clock, Eye, Server, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ShareConsentKey } from '../../../shared/types';

/*
 * Keyed rather than ordered on purpose: SHARE_CONSENT_KEYS owns the order, and a parallel
 * array here would silently mispair icons the first time a bullet is inserted.
 */
export const SHARE_CONSENT_ICONS: Record<ShareConsentKey, LucideIcon> = {
  'share.consent.thirdParty': Server,
  'share.consent.encrypted': ShieldCheck,
  'share.consent.anyoneWithLink': Eye,
  'share.consent.expires': Clock,
  'share.consent.browserCeiling': TriangleAlert,
};
