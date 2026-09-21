import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, Group, Stack, Text } from '@mantine/core';
import { TriangleAlert } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { VariableField } from './VariableField';
import { analyzeFlow } from './flowCapabilities';
import { SKILL_ICON } from './skills';
import { TemplateIcon } from './TemplateIcon';
import { useI18nStore } from '../../store/i18nStore';
import { useAppStore } from '../../store/appStore';
import { telegramApi, lineApi } from '../../api/electronApi';
import { missingRequiredVariables } from '../../../../shared/flowVariables';
import type { FlowTemplate } from './examples';
import type { FlowDefinition, FlowVariable } from '../../../../shared/types';
import { Z_MODAL_NESTED } from '../../config/zLayers';

export interface FlowSetupWizardProps {
  template: FlowTemplate | null;
  t: (key: string) => string;
  onClose: () => void;
  /**
   * Leaving for another view. Distinct from `onClose`, which only drops back to the template
   * gallery still open underneath — that gallery would otherwise sit on top of Settings.
   */
  onNavigateAway: () => void;
  onCreate: (flow: FlowDefinition) => void;
}

export const FlowSetupWizard: React.FC<FlowSetupWizardProps> = ({ template, t, onClose, onNavigateAway, onCreate }) => {
  const locale = useI18nStore((s) => s.locale);
  const setView = useAppStore((s) => s.setView);
  const [flow, setFlow] = useState<FlowDefinition | null>(null);
  const [botConfigured, setBotConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    setFlow(template ? template.build(t, locale) : null);
  }, [template, t, locale]);

  const needsBot = useMemo(() => (flow ? analyzeFlow(flow).setup.includes('bot') : false), [flow]);

  useEffect(() => {
    if (!needsBot) { setBotConfigured(true); return; }
    let alive = true;
    setBotConfigured(null);
    void Promise.all([telegramApi.getSettings(), lineApi.getSettings()]).then(([tg, ln]) => {
      if (alive) setBotConfigured(tg.hasToken || ln.hasChannelAccessToken);
    });
    return () => { alive = false; };
  }, [needsBot]);

  if (!template || !flow) return null;

  const variables = flow.variables ?? [];
  const missing = missingRequiredVariables(flow);
  const missingNames = missing.map((v) => v.label || v.key).join(', ');

  const setVarValue = (key: string, value: string): void => {
    setVarValues({ [key]: value });
  };

  const setVarValues = (patch: Record<string, string>): void => {
    setFlow((f) => (f ? {
      ...f,
      variables: (f.variables ?? []).map((v) => (v.key in patch ? { ...v, value: patch[v.key] } : v)),
    } : f));
  };

  const goToSettings = (): void => { setView('settings'); onNavigateAway(); };

  return (
    <AppModal
      opened
      onClose={onClose}
      title={t(template.titleKey)}
      icon={template.icon ? <template.icon size={16} /> : SKILL_ICON[template.primarySkill]}
      size="md"
      zIndex={Z_MODAL_NESTED}
    >
      <Stack gap="md">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <TemplateIcon template={template} size={40} />
          <Text fz="sm" c="dimmed" style={{ lineHeight: 1.6 }}>{t(template.descKey)}</Text>
        </Group>

        {needsBot && botConfigured === false && (
          <Box
            p="xs"
            style={{
              background: 'var(--mantine-color-orange-light)',
              borderRadius: 'var(--mantine-radius-md)',
              border: '1px solid var(--mantine-color-orange-filled)',
            }}
          >
            <Group gap="sm" align="flex-start" wrap="nowrap">
              <TriangleAlert size={16} color="var(--mantine-color-orange-filled)" style={{ marginTop: 2, flexShrink: 0 }} />
              <Stack gap={6} style={{ flex: 1 }}>
                <Text fz="xs" style={{ lineHeight: 1.6 }}>
                  {t(template.category === 'command'
                    ? 'flow.setup.needsBot.command'
                    : 'flow.setup.needsBot.push')}
                </Text>
                <Button variant="light" color="orange" size="xs" onClick={goToSettings} style={{ alignSelf: 'flex-start' }}>
                  {t('flow.setup.openSettings')}
                </Button>
              </Stack>
            </Group>
          </Box>
        )}

        {variables.length === 0 ? (
          <Text fz="sm" c="dimmed">{t('flow.setup.nothingToSetUp')}</Text>
        ) : (
          <Stack gap="sm">
            {variables.filter((v: FlowVariable) => !v.hiddenInSetup).map((variable: FlowVariable) => (
              <VariableField
                key={variable.key}
                variable={variable}
                allVariables={variables}
                asQuestion
                onChange={(value) => setVarValue(variable.key, value)}
                onChangeMany={setVarValues}
                onBeforeNavigate={onNavigateAway}
                t={t}
              />
            ))}
          </Stack>
        )}

        {missing.length > 0 && (
          <Group gap={6} align="center" wrap="nowrap">
            <TriangleAlert size={13} color="var(--mantine-color-orange-filled)" style={{ flexShrink: 0 }} />
            <Text fz="xs" c="dimmed">{t('flow.setup.missingPrefix')}{missingNames}</Text>
          </Group>
        )}

        <Group justify="flex-end">
          {/* Not "cancel": this drops back into the still-open template gallery. */}
          <Button variant="default" size="xs" onClick={onClose}>{t('flow.setup.back')}</Button>
          <Button variant="filled" size="xs" disabled={missing.length > 0} onClick={() => onCreate(flow)}>
            {t('flow.setup.add')}
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
};
