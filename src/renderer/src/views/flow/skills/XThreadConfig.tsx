import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { isValidXPostUrlOrVar, postSiteOf } from './validation';
import { XSignInNotice, type PostSignInSite } from './XSignInNotice';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { PostSiteId } from '../../../../../shared/linkSites/types';

const SIGN_IN_SITES: ReadonlySet<PostSiteId> = new Set<PostSiteId>(['x', 'threads', 'instagram', 'facebook']);

/**
 * What the sign-in line above the link says: the site's own sign-in for a fixed link of a site
 * that has one, one line naming every such site for a variable or a blank field, nothing for a
 * site read signed out alone (PTT, Dcard…).
 */
export function threadSignIn(url: string): { site: PostSignInSite } | 'any' | null {
  if (url.includes('{{') || !url.trim()) return 'any';
  const site = postSiteOf(url);
  return site !== null && SIGN_IN_SITES.has(site) ? { site: site as PostSignInSite } : null;
}

export const XThreadConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidXPostUrlOrVar(url);
  const maxReplies = step.config.maxReplies ?? '20';
  const signIn = threadSignIn(url);
  // PTT's replies are pushes, written out up to a length budget rather than one by one.
  const pushes = postSiteOf(url) === 'ptt';

  return (
    <Stack gap="xs">
      {signIn === 'any' && <Text fz="xs" c="var(--text-muted)">{t('flow.skill.x_thread.signIn.any')}</Text>}
      {signIn !== null && signIn !== 'any' && <XSignInNotice limit="replies" site={signIn.site} t={t} />}

      <AppTextInput
        label={t('flow.skill.x_thread.url')}
        placeholder={t('flow.skill.x_thread.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        mono
        error={urlError ? t('flow.skill.x_thread.url.error') : undefined}
      />

      <AppNumberInput
        label={pushes ? t('flow.skill.x_thread.maxReplies.pushes') : t('flow.skill.x_thread.maxReplies')}
        description={pushes ? t('flow.skill.x_thread.maxReplies.pushes.desc') : t('flow.skill.x_thread.maxReplies.desc')}
        value={maxReplies}
        onChange={(v) => onChange({ ...step.config, maxReplies: v === '' ? '' : String(v) })}
        size="sm"
        min={0}
        step={5}
        allowDecimal={false}
        allowNegative={false}
      />

      <SettingRow
        label={t('flow.skill.x_thread.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.x_thread.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.x_thread.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
