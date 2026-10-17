import React from 'react';
import {
  AE, AR, AT, AU, BD, BE, BN, BR, CA, CH, CL, CN, CO, CZ, DE, DK, EG, ES, FI, FR, GB, GR, HK, HU, ID, IE, IL, IN, IS, IT, JP,
  KH, KR, LA, LU, MM, MN, MO, MX, MY, NL, NO, NZ, PE, PH, PK, PL, PT, QA, RO, RU, SA, SE, SG, TH, TR, TW, UA, US, VN, ZA,
} from 'country-flag-icons/react/3x2';

type Flag = typeof TW;

/**
 * Drawn, not typed: Windows has no flag emoji, so a regional-indicator pair shows as two letters.
 * The set is every code `PTT_REGION_CODES` holds; this module is loaded only when a card has one.
 */
export const FLAGS: Record<string, Flag> = {
  AE, AR, AT, AU, BD, BE, BN, BR, CA, CH, CL, CN, CO, CZ, DE, DK, EG, ES, FI, FR, GB, GR, HK, HU, ID, IE, IL, IN, IS, IT, JP,
  KH, KR, LA, LU, MM, MN, MO, MX, MY, NL, NO, NZ, PE, PH, PK, PL, PT, QA, RO, RU, SA, SE, SG, TH, TR, TW, UA, US, VN, ZA,
};

/** The region's flag at the text's height; nothing for a code without one. */
export default function RegionFlag({ code }: { code: string }): React.ReactElement | null {
  const Shape = FLAGS[code];
  if (!Shape) return null;
  return (
    <Shape
      aria-hidden
      style={{ height: '0.9em', width: 'auto', borderRadius: 2, boxShadow: '0 0 0 1px var(--border)', flexShrink: 0 }}
    />
  );
}
