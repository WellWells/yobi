import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Code, Collapse, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { ChevronDown, ChevronRight, TriangleAlert, ShieldCheck, Terminal, Workflow } from 'lucide-react';
import type { AgentConfirmChoice, AgentConfirmPayload, AgentConfirmRow } from '../../../shared/types';
import { ipcEvents, windowApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { AppModal } from './AppModal';
import { AppButton } from './AppButton';
import { Z_MODAL_CONFIRM } from '../config/zLayers';

function rowValue(row: AgentConfirmRow, t: (key: string) => string): string {
  if (!row.valueKey) return row.value;
  return Object.entries(row.vars ?? {}).reduce(
    (text, [name, value]) => text.split(`{{${name}}}`).join(value),
    t(row.valueKey),
  );
}

/** The facts behind a connector action, each on its own line — the JSON stays one click away. */
function ConfirmRows({ rows, t }: { rows: AgentConfirmRow[]; t: (key: string) => string }) {
  return (
    <Stack gap={8}>
      {rows.map((row) => (
        <Group key={`${row.key}-${row.value}`} gap={12} wrap="nowrap" align="flex-start">
          <Text fz="var(--font-size-xs)" c="dimmed" w={72} style={{ flexShrink: 0, lineHeight: 1.6 }}>
            {t(`agent.mcp.confirm.row.${row.key}`)}
          </Text>
          <Text fz="var(--font-size-sm)" c="var(--text-primary)" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {rowValue(row, t)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

export const AgentConfirmDialog: React.FC = () => {
  const t = useI18nStore((s) => s.t);
  const [queue, setQueue] = useState<AgentConfirmPayload[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const current = queue[0];

  useEffect(() => ipcEvents.onAgentConfirm((payload) => {
    setQueue((prev) => (prev.some((item) => item.id === payload.id) ? prev : [...prev, payload]));
  }), []);

  // Main settles a confirmation on its own when it times out or the run is cancelled. The modal
  // has to come down with it, or the next request slides into the same box under the cursor and
  // the click meant for a stale `git status` lands on a live `rmdir /s /q`.
  useEffect(() => ipcEvents.onAgentConfirmDismiss((id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }), []);

  const respond = useCallback((choice: AgentConfirmChoice) => {
    setDetailsOpen(false);
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (head) windowApi.respondAgentConfirm(head.id, choice);
      return rest;
    });
  }, []);

  if (!current) return null;

  const isFlow = current.kind === 'flow';
  const isShell = current.kind === 'shell';
  // Shell is dangerous by construction — there is no "safe" arbitrary command — where a flow is
  // only dangerous when one of its steps is.
  const isMcp = current.kind === 'mcp';
  const rows = isMcp ? current.rows ?? [] : [];
  const dangerous = isShell || (isFlow && current.sensitiveTypes.length > 0) || (isMcp && current.danger === true);
  // Older payloads carry no flag; only an explicit false hides the button.
  const allowAlways = isMcp && current.allowAlways !== false;
  const titleKey = isFlow ? 'agent.flow.confirm.title' : isShell ? 'agent.shell.confirm.title' : 'agent.mcp.confirm.title';
  const detailKey = isFlow ? 'agent.flow.confirm.detail' : isShell ? 'agent.shell.confirm.detail' : 'agent.mcp.confirm.detail';
  const denyKey = isFlow ? 'agent.flow.confirm.discard' : isShell ? 'agent.shell.confirm.deny' : 'agent.mcp.confirm.deny';
  const allowKey = isFlow ? 'agent.flow.confirm.save' : isShell ? 'agent.shell.confirm.allow' : 'agent.mcp.confirm.allow';

  return (
    <AppModal
      // Remounts when the request changes, so a swapped-in request cannot inherit a click that
      // was already travelling toward the previous one.
      key={current.id}
      opened
      onClose={() => respond('deny')}
      zIndex={Z_MODAL_CONFIRM}
      size={isFlow ? 'md' : 'lg'}
      icon={isShell ? <Terminal size={18} /> : dangerous ? <TriangleAlert size={18} /> : isFlow ? <Workflow size={18} /> : <ShieldCheck size={18} />}
      title={t(titleKey)}
    >
      <Stack gap={14}>
        <Text fz="var(--font-size-sm)" c="var(--text-primary)" style={{ lineHeight: 1.6 }}>
          {isFlow
            ? t('agent.flow.confirm.message')
              .replace('{{name}}', current.flowName)
              .replace('{{count}}', String(current.stepTypes.length))
            : isShell
              ? t('agent.shell.confirm.message').replace('{{shell}}', current.interpreter)
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
        ) : rows.length > 0 && !isShell ? (
          <Stack gap={10}>
            <ConfirmRows rows={rows} t={t} />
            <AppButton
              variant="subtle"
              size="compact-sm"
              leftSection={detailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => setDetailsOpen((open) => !open)}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('agent.mcp.confirm.details')}
            </AppButton>
            <Collapse expanded={detailsOpen}>
              <ScrollArea.Autosize mah={180}>
                <Code block fz="var(--font-size-xs)" style={{ background: 'var(--bg-tertiary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {isMcp ? current.argsPreview : ''}
                </Code>
              </ScrollArea.Autosize>
            </Collapse>
          </Stack>
        ) : (
          <Stack gap={6}>
            <ScrollArea.Autosize mah={220}>
              <Code
                block
                fz="var(--font-size-xs)"
                // The command is no longer clipped, so it must WRAP: a long one that scrolled
                // off to the right would hide its tail exactly as the old 2,000-char clip did.
                style={{ background: 'var(--bg-tertiary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              >
                {isShell ? current.command : current.argsPreview}
              </Code>
            </ScrollArea.Autosize>
            {isShell && (
              <Text fz="var(--font-size-xs)" c="dimmed">
                {t('agent.shell.confirm.where').replace('{{cwd}}', current.cwd)}
              </Text>
            )}
          </Stack>
        )}

        {isFlow && dangerous && (
          <Text fz="var(--font-size-sm)" c="var(--danger)" style={{ lineHeight: 1.6 }}>
            {t('agent.flow.confirm.warning')
              .replace('{{types}}', current.sensitiveTypes.map((type) => t(`flow.skill.${type}`)).join('、'))}
          </Text>
        )}

        <Text fz="var(--font-size-sm)" c="dimmed" style={{ lineHeight: 1.6 }}>
          {t(detailKey)}
        </Text>

        <Group justify="flex-end" gap={8}>
          <AppButton variant="default" onClick={() => respond('deny')}>
            {t(denyKey)}
          </AppButton>
          {/* MCP only. A shell command is approved one at a time, on purpose — see confirmShell. */}
          {allowAlways && (
            <AppButton variant="subtle" onClick={() => respond('approveAlways')}>
              {t('agent.mcp.confirm.always')}
            </AppButton>
          )}
          <AppButton color={dangerous ? 'red' : undefined} onClick={() => respond('approve')}>
            {t(allowKey)}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
