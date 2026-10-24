import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Anchor, Badge, Box, Button, Divider, Group, ScrollArea, Stack, Text,
} from '@mantine/core';
import { CornerDownRight, ShieldAlert, TriangleAlert } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { SKILL_ICON, skillHue } from './skills';
import { analyzeFlow, isCodeSummary, llmProviderLabel, summarizeStep } from './flowCapabilities';
import type { FlowDefinition } from '../../../../shared/types';
import { Z_MODAL_CONFIRM } from '../../config/zLayers';
import { fillTemplate } from '../../../../shared/fillTemplate';

const EXPANDABLE_OVER = 100;

export interface FlowPreviewConfirmProps {
  flows: FlowDefinition[] | null;
  t: (key: string) => string;
  onCancel: () => void;
  onConfirm: (flows: FlowDefinition[]) => void;
}

export const StepRow: React.FC<{
  index: number;
  flow: FlowDefinition;
  riskySteps: Set<number>;
  t: (key: string) => string;
}> = ({ index, flow, riskySteps, t }) => {
  const [expanded, setExpanded] = useState(false);
  const step = flow.steps[index];
  const position = index + 1;
  const risky = riskySteps.has(position);
  const summary = summarizeStep(step.type, step.config);
  const isCode = isCodeSummary(step.type);
  const provider = step.type === 'llm' ? llmProviderLabel(step.config.provider) : '';
  const canExpand = summary.length > EXPANDABLE_OVER;

  return (
    <Group
      gap="xs"
      wrap="nowrap"
      align="flex-start"
      px={6}
      py={4}
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        background: risky ? 'color-mix(in srgb, var(--mantine-color-error) 10%, transparent)' : undefined,
      }}
    >
      <Text fz="xs" c="dimmed" w={20} ta="right" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {position}
      </Text>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6} wrap="nowrap" align="center">
          <Badge
            variant="light"
            color={risky ? 'var(--mantine-color-error)' : skillHue(step.type)}
            size="sm"
            leftSection={SKILL_ICON[step.type]}
            style={{ flexShrink: 0 }}
          >
            {t(`flow.skill.${step.type}`)}
          </Badge>
          {provider && (
            <Group gap={2} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
              <CornerDownRight size={11} color="var(--mantine-color-dimmed)" />
              <Text fz="xs" c="dimmed">
                {fillTemplate(t('flow.import.confirm.llmSentTo'), { provider })}
              </Text>
            </Group>
          )}
        </Group>
        {summary && (
          <Text
            fz="xs"
            ff={isCode ? 'monospace' : undefined}
            c="dimmed"
            lineClamp={expanded ? undefined : 2}
            style={{ minWidth: 0, wordBreak: isCode ? 'break-all' : 'break-word', whiteSpace: 'pre-wrap' }}
          >
            {summary}
          </Text>
        )}
        {canExpand && (
          <Anchor component="button" type="button" fz="xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('flow.import.confirm.showLess') : t('flow.import.confirm.showMore')}
          </Anchor>
        )}
      </Stack>
    </Group>
  );
};

export const FlowPreviewConfirm: React.FC<FlowPreviewConfirmProps> = ({
  flows, t, onCancel, onConfirm,
}) => {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const analyses = useMemo(
    () => (flows ?? []).map((flow) => ({ flow, caps: analyzeFlow(flow) })),
    [flows],
  );
  const hasRisk = analyses.some((a) => a.caps.hasRisk);

  useEffect(() => {
    setScrolledToEnd(false);
  }, [flows]);

  useEffect(() => {
    const sentinel = endRef.current;
    const viewport = viewportRef.current;
    if (!flows || !hasRisk || !sentinel || !viewport) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) setScrolledToEnd(true); },
      { root: viewport, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [flows, hasRisk]);

  const handleConfirm = useCallback(() => {
    if (flows) onConfirm(flows);
  }, [flows, onConfirm]);

  if (!flows || flows.length === 0) return null;

  const canImport = !hasRisk || scrolledToEnd;
  const title = flows.length === 1
    ? fillTemplate(t('flow.import.confirm.title'), { name: flows[0].name })
    : fillTemplate(t('flow.import.confirm.title.many'), { count: String(flows.length) });

  return (
    <AppModal
      opened
      onClose={onCancel}
      title={title}
      icon={hasRisk ? <ShieldAlert size={16} /> : undefined}
      size="lg"
      zIndex={Z_MODAL_CONFIRM}
    >
      <Stack gap="md">
        <Text fz="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
          {t('flow.import.confirm.intro')}
        </Text>

        {analyses.map(({ flow, caps }) => (
            <Stack key={flow.id} gap="xs">
              {flows.length > 1 && <Text fz="sm" fw={600}>{flow.name}</Text>}

              {caps.hasRisk && (
                <Alert
                  color="var(--mantine-color-error)"
                  icon={<TriangleAlert size={14} />}
                  title={t('flow.import.confirm.risk')}
                  p="xs"
                >
                  <Stack gap={4}>
                    {caps.risks.map((risk) => (
                      <Text key={risk.kind} fz="xs">
                        {`• ${t(`flow.import.confirm.risk.${risk.kind}`)} — ${
                          fillTemplate(t('flow.import.confirm.risk.steps'), { steps: risk.steps.join(', ') })
                        }`}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              )}

              {(caps.access.length > 0 || caps.setup.length > 0) && (
                <Group gap="xs" wrap="wrap">
                  {caps.setup.map((kind) => (
                    <Badge key={kind} variant="light" size="sm">
                      {t(`flow.import.confirm.setup.${kind}`)}
                    </Badge>
                  ))}
                  {caps.access.map((kind) => (
                    <Badge key={kind} variant="default" size="sm">
                      {t(`flow.import.confirm.access.${kind}`)}
                    </Badge>
                  ))}
                </Group>
              )}

              {caps.watchFolders.map((folder) => (
                <Text key={folder} fz="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                  {t('flow.import.confirm.watchFolder')}
                  <Text span fz="xs" ff="monospace">{folder}</Text>
                </Text>
              ))}

              <Text fz="xs" c="dimmed">
                {fillTemplate(t('flow.import.confirm.steps'), { count: String(flow.steps.length) })}
              </Text>
            </Stack>
        ))}

        <Divider />

        <ScrollArea.Autosize mah={280} viewportRef={viewportRef} type="auto">
          <Stack gap={2} pr="xs">
            {analyses.map(({ flow, caps }) => {
              const riskySteps = new Set(caps.risks.flatMap((r) => r.steps));
              return (
                <React.Fragment key={flow.id}>
                  {flows.length > 1 && (
                    <Text fz="xs" fw={600} c="dimmed" mt={6}>{flow.name}</Text>
                  )}
                  {flow.steps.map((step, index) => (
                    <StepRow key={step.id} index={index} flow={flow} riskySteps={riskySteps} t={t} />
                  ))}
                </React.Fragment>
              );
            })}
            <Box ref={endRef} h={1} aria-hidden />
          </Stack>
        </ScrollArea.Autosize>

        {hasRisk && !scrolledToEnd && (
          <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.import.confirm.scrollHint')}</Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={onCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="filled"
            color={hasRisk ? 'red' : undefined}
            size="xs"
            disabled={!canImport}
            onClick={handleConfirm}
          >
            {hasRisk ? t('flow.import.confirm.acceptRisk') : t('flow.import.confirm.accept')}
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
};
