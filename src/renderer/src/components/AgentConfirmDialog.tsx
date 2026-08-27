import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Code, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { TriangleAlert, ShieldCheck, Workflow } from 'lucide-react';
import type { AgentConfirmChoice, AgentConfirmPayload } from '../../../shared/types';
import { ipcEvents, windowApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { AppModal } from './AppModal';
import { AppButton } from './AppButton';
import { Z_MODAL_CONFIRM } from '../config/zLayers';

export const AgentConfirmDialog: React.FC = () => {
  const t = useI18nStore((s) => s.t);
  const [queue, setQueue] = useState<AgentConfirmPayload[]>([]);
  const current = queue[0];

  useEffect(() => ipcEvents.onAgentConfirm((payload) => {
    setQueue((prev) => (prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]));
  }), []);

  const respond = useCallback((choice: AgentConfirmChoice) => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (head) windowApi.respondAgentConfirm(head.id, choice);
      return rest;
    });
  }, []);

  if (!current) return null;

  const isFlow = current.kind === 'flow';
  const dangerous = isFlow && current.sensitiveTypes.length > 0;

  return (
    <AppModal
      opened
      onClose={() => respond('deny')}
      zIndex={Z_MODAL_CONFIRM}
      size={isFlow ? 'md' : 'lg'}
      icon={dangerous ? <TriangleAlert size={18} /> : isFlow ? <Workflow size={18} /> : <ShieldCheck size={18} />}
      title={t(isFlow ? 'agent.flow.confirm.title' : 'agent.mcp.confirm.title')}
    >
      <Stack gap={14}>
        <Text fz="var(--font-size-sm)" c="var(--text-primary)" style={{ lineHeight: 1.6 }}>
          {isFlow
            ? t('agent.flow.confirm.message')
              .replace('{{name}}', current.flowName)
              .replace('{{count}}', String(current.stepTypes.length))
            : t('agent.mcp.confirm.message')
              .replace('{{tool}}', current.toolName)
              .replace('{{server}}', current.serverName)}
        </Text>

        {isFlow ? (
          <Stack gap={6}>
            <Text fz="var(--font-size-xs)" c="dimmed" fw={600}>
              {t('agent.flow.confirm.steps')}
            </Text>
            <ScrollArea.Autosize mah={140}>
              <Group gap={6}>
                {current.stepTypes.map((type, index) => (
                  <Badge
                    key={`${type}-${index}`}
                    variant="light"
                    color={current.sensitiveTypes.includes(type) ? 'red' : undefined}
                    radius="sm"
                    tt="none"
                    fw={500}
                  >
                    {t(`flow.skill.${type}`)}
                  </Badge>
                ))}
              </Group>
            </ScrollArea.Autosize>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={220}>
            <Code block fz="var(--font-size-xs)" style={{ background: 'var(--bg-tertiary)' }}>
              {current.argsPreview}
            </Code>
          </ScrollArea.Autosize>
        )}

        {dangerous && (
          <Text fz="var(--font-size-sm)" c="var(--danger)" style={{ lineHeight: 1.6 }}>
            {t('agent.flow.confirm.warning')
              .replace('{{types}}', current.sensitiveTypes.map((type) => t(`flow.skill.${type}`)).join('、'))}
          </Text>
        )}

        <Text fz="var(--font-size-sm)" c="dimmed" style={{ lineHeight: 1.6 }}>
          {t(isFlow ? 'agent.flow.confirm.detail' : 'agent.mcp.confirm.detail')}
        </Text>

        <Group justify="flex-end" gap={8}>
          <AppButton variant="default" onClick={() => respond('deny')}>
            {t(isFlow ? 'agent.flow.confirm.discard' : 'agent.mcp.confirm.deny')}
          </AppButton>
          {
}
          {!isFlow && (
            <AppButton variant="subtle" onClick={() => respond('approveAlways')}>
              {t('agent.mcp.confirm.always')}
            </AppButton>
          )}
          <AppButton color={dangerous ? 'red' : undefined} onClick={() => respond('approve')}>
            {t(isFlow ? 'agent.flow.confirm.save' : 'agent.mcp.confirm.allow')}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
