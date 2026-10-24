import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Stack, Text } from '@mantine/core';
import { Info, RefreshCw, Settings, TriangleAlert } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { mcpApi } from '../../../api/electronApi';
import { useAppStore } from '../../../store/appStore';
import { useMcpStore } from '../../../store/useMcpStore';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { reachableOnSend } from '../../../../../shared/mcpConnectOnUse';
import {
  argumentsSkeleton,
  interpolateMcpArguments,
  missingRequiredArguments,
  storedMcpAccess,
  type McpFlowTool,
  type McpFlowToolField,
  type McpFlowToolsResult,
  type McpStepAccess,
} from '../../../../../shared/mcpFlowStep';
import type { McpServerView } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

/** Arguments are re-checked (the access of a Notion edit depends on them) once typing pauses. */
const REFRESH_DELAY_MS = 400;

const ACCESS_ORDER: readonly McpStepAccess[] = ['read', 'write', 'delete'];

type Translate = (key: string) => string;

/** The step names its server by id; an AI-built step may name it instead. */
function findServer(servers: readonly McpServerView[], ref: string): McpServerView | undefined {
  const wanted = ref.trim();
  if (!wanted) return undefined;
  const folded = wanted.replace(/^\//, '').normalize('NFKC').toLowerCase();
  return servers.find((server) => server.id === wanted)
    ?? servers.find((server) => server.name.normalize('NFKC').toLowerCase() === folded);
}

function serverLabel(server: McpServerView, t: Translate): string {
  if (reachableOnSend(server)) return server.name;
  const state = server.status === 'error' ? 'unavailable' : 'needsSignIn';
  return `${server.name} · ${t(`flow.skill.mcp.server.${state}`)}`;
}

function fieldLine(field: McpFlowToolField): string {
  const type = field.options ? field.options.join(' | ') : field.type;
  return `${field.name}${field.required ? '*' : ''}${type ? `: ${type}` : ''}`;
}

/**
 * The `mcp` step: a connector, one of its tools, and the JSON arguments to call it with. The tool
 * list comes from the connector itself, connected here only when that needs no sign-in; a sign-in
 * is left to Settings. Picking a tool stores what it does (`access`), which the import gate and a
 * bot-started run read.
 */
export const McpConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const currentView = useAppStore((s) => s.currentView);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const servers = useMcpStore((s) => s.servers);
  const [result, setResult] = useState<McpFlowToolsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  // One connect attempt per server picked (and per Retry), not one per keystroke in the arguments.
  const connectTried = useRef('');

  const serverRef = step.config.server ?? '';
  const toolName = step.config.tool ?? '';
  const argsText = step.config.arguments ?? '';
  const server = findServer(servers, serverRef);
  const serverId = server?.id ?? '';
  const serverStatus = server?.status;

  useEffect(() => {
    if (currentView !== 'flow' || !serverId) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const connect = connectTried.current !== `${serverId}#${retry}`;
      connectTried.current = `${serverId}#${retry}`;
      setLoading(true);
      void mcpApi.flowTools({ serverId, connect, ...(toolName ? { tool: toolName, args: argsText } : {}) })
        .then((next) => { if (!cancelled) setResult(next); })
        .catch(() => { if (!cancelled) setResult({ status: 'unavailable', tools: [] }); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentView, serverId, serverStatus, toolName, argsText, retry]);

  // What the tool does with these arguments is what the step stores, so the import gate and a
  // bot-started run read the same answer the editor shows. Keyed on the answer alone: the config
  // read here is the one rendered with it.
  const liveAccess = result?.selectedAccess;
  useEffect(() => {
    if (!liveAccess || liveAccess === step.config.access) return;
    onChange({ ...step.config, access: liveAccess });
  }, [liveAccess]);

  const tools: McpFlowTool[] = useMemo(() => result?.tools ?? [], [result]);
  const picked = tools.find((tool) => tool.name === toolName);

  const serverOptions = useMemo(() => {
    const options = servers.map((entry) => ({ value: entry.id, label: serverLabel(entry, t) }));
    if (serverRef && !server) options.push({ value: serverRef, label: fillTemplate(t('flow.skill.mcp.server.missing'), { server: serverRef }) });
    return options;
  }, [servers, serverRef, server, t]);

  const toolOptions = useMemo(() => {
    const groups = ACCESS_ORDER
      .map((access) => ({
        group: t(`flow.skill.mcp.access.${access}`),
        items: tools.filter((tool) => tool.access === access).map((tool) => ({ value: tool.name, label: tool.title ?? tool.name })),
      }))
      .filter((group) => group.items.length > 0);
    if (toolName && !picked) return [{ value: toolName, label: toolName }, ...groups];
    return groups;
  }, [tools, toolName, picked, t]);

  const parsed = interpolateMcpArguments(argsText, (name) => `{{${name}}}`);
  const missing = parsed.ok && picked ? missingRequiredArguments(parsed.value, picked.fields) : [];
  const argsError = !parsed.ok
    ? t(parsed.reason === 'notObject' ? 'flow.skill.mcp.arguments.notObject' : 'flow.skill.mcp.arguments.invalid')
    : missing.length > 0 ? fillTemplate(t('flow.skill.mcp.arguments.missing'), { fields: missing.join(', ') }) : undefined;

  const access = storedMcpAccess(step.config.access);
  const status = result?.status;
  const serverName = server?.name ?? serverRef;

  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('flow.skill.mcp.server')}
        placeholder={t('flow.skill.mcp.server.placeholder')}
        options={serverOptions}
        value={server?.id ?? (serverRef || null)}
        onChange={(next) => onChange({ ...step.config, server: next, tool: '', access: '' })}
        searchable
        nothingFoundMessage={t('flow.skill.mcp.noServers')}
        size="sm"
      />
      {servers.length === 0 && (
        <Text fz="xs" c="dimmed">{t('flow.skill.mcp.noServers')}</Text>
      )}

      {server && status === 'needsSignIn' && (
        <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
          <Stack gap={6}>
            <Text fz="xs" style={{ lineHeight: 1.6 }}>{fillTemplate(t('flow.skill.mcp.signIn'), { server: serverName })}</Text>
            <AppButton
              variant="light"
              color="var(--mantine-color-warning)"
              size="compact-xs"
              leftSection={<Settings size={12} />}
              onClick={() => openSettingsCategory('connectors')}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('flow.setup.openSettings')}
            </AppButton>
          </Stack>
        </Alert>
      )}
      {server && status === 'unavailable' && (
        <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
          <Stack gap={6}>
            <Text fz="xs" style={{ lineHeight: 1.6 }}>{fillTemplate(t('flow.skill.mcp.unavailable'), { server: serverName })}</Text>
            <AppButton
              variant="light"
              color="var(--mantine-color-warning)"
              size="compact-xs"
              leftSection={<RefreshCw size={12} />}
              loading={loading}
              onClick={() => setRetry((count) => count + 1)}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('flow.skill.mcp.retry')}
            </AppButton>
          </Stack>
        </Alert>
      )}

      <SelectDropdown
        label={t('flow.skill.mcp.tool')}
        placeholder={loading && tools.length === 0 ? t('flow.skill.mcp.tool.loading') : t('flow.skill.mcp.tool.placeholder')}
        options={toolOptions}
        value={toolName || null}
        onChange={(next) => {
          const tool = tools.find((entry) => entry.name === next);
          onChange({
            ...step.config,
            tool: next,
            access: tool?.access ?? '',
            arguments: argsText.trim() ? argsText : argumentsSkeleton(tool?.fields ?? []),
          });
        }}
        searchable
        disabled={!server}
        size="sm"
      />
      {toolName && access === 'read' && (
        <Text fz="xs" c="dimmed">{t('flow.skill.mcp.access.read.hint')}</Text>
      )}
      {toolName && (access === 'write' || access === 'delete') && (
        <Alert
          color={access === 'delete' ? 'var(--mantine-color-error)' : 'var(--mantine-color-warning)'}
          icon={<TriangleAlert size={14} />}
          p="xs"
        >
          <Text fz="xs" style={{ lineHeight: 1.6 }}>
            {fillTemplate(t(`flow.skill.mcp.access.${access}.hint`), { server: serverName })}
          </Text>
        </Alert>
      )}

      <AppTextarea
        label={t('flow.skill.mcp.arguments')}
        placeholder={t('flow.skill.mcp.arguments.placeholder')}
        value={argsText}
        onChange={(e) => onChange({ ...step.config, arguments: e.currentTarget.value })}
        minRows={3}
        autosize
        mono
        size="sm"
        error={argsError}
      />
      {parsed.ok && parsed.repaired && (
        <Text fz="xs" c="var(--mantine-color-warning)" ff="monospace" style={{ wordBreak: 'break-all' }}>
          {fillTemplate(t('flow.skill.mcp.arguments.readAs'), { json: JSON.stringify(parsed.value) })}
        </Text>
      )}
      {picked && picked.fields.length > 0 && (
        <Text fz="xs" c="dimmed">
          {fillTemplate(t('flow.skill.mcp.fields'), { fields: picked.fields.map(fieldLine).join(' · ') })}
        </Text>
      )}

      <ToggleSwitch
        label={t('flow.skill.mcp.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="dimmed">
          {fillTemplate(t('flow.skill.mcp.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        </Text>
      )}

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.mcp.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
