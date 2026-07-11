import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor, Badge, Box, Button, Divider, Group, ScrollArea, Stack, Text,
} from '@mantine/core';
import { CornerDownRight, ShieldAlert, TriangleAlert } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { SKILL_ICON, skillHue } from './skills';
import { analyzeFlow, llmProviderLabel, summarizeStep } from './flowCapabilities';
import type { FlowDefinition } from '../../../../shared/types';

// A step summary past this length gets a show-more toggle instead of being clamped
// away. Long values are exactly the ones worth reading — a shell command, or an
// llm prompt that decides what leaves the machine.
const EXPANDABLE_OVER = 100;

// The gate every UNTRUSTED flow passes through — a JSON file picked, dropped, or
// fetched from a URL — before a single byte reaches flows.json.
//
// It exists because the skill set includes shell, run, js and browser_js: until
// now, pasting a URL and pressing Enter was arbitrary code execution, and nothing
// afterwards told you the flow you just imported contained a shell step.
//
// Built-in templates deliberately skip this: they ship inside the app binary, so
// a dialog asking the user to vouch for code they already installed teaches them
// to click through the one that matters.
//
// The scroll requirement is Apple's, and it is the whole point: a disclosure the
// user can dismiss without seeing is decoration. When a flow carries a risky
// step, the import button stays disabled until the step list has been read to the
// bottom.

export interface FlowPreviewConfirmProps {
  flows: FlowDefinition[] | null;
  t: (key: string) => string;
  onCancel: () => void;
  onConfirm: (flows: FlowDefinition[]) => void;
}

const StepRow: React.FC<{
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
  // The one destination worth naming: an llm step sends its prompt to this AI.
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
        background: risky ? 'var(--mantine-color-red-light)' : undefined,
      }}
    >
      <Text fz="xs" c="dimmed" w={20} ta="right" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {position}
      </Text>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6} wrap="nowrap" align="center">
          <Badge
            variant="light"
            color={risky ? 'red' : skillHue(step.type)}
            size="sm"
            radius="sm"
            leftSection={SKILL_ICON[step.type]}
            style={{ flexShrink: 0 }}
          >
            {t(`agentflow.skill.${step.type}`)}
          </Badge>
          {provider && (
            <Group gap={2} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
              <CornerDownRight size={11} color="var(--mantine-color-dimmed)" />
              <Text fz="xs" c="dimmed">
                {t('agentflow.import.confirm.llmSentTo').replace('{{provider}}', provider)}
              </Text>
            </Group>
          )}
        </Group>
        {summary && (
          <Text
            fz="xs"
            ff="monospace"
            c="dimmed"
            lineClamp={expanded ? undefined : 2}
            style={{ minWidth: 0, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}
          >
            {summary}
          </Text>
        )}
        {canExpand && (
          <Anchor component="button" type="button" fz="xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('agentflow.import.confirm.showLess') : t('agentflow.import.confirm.showMore')}
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

  // Reset per opened payload — a previous flow's "I read it" must not carry over.
  useEffect(() => {
    setScrolledToEnd(false);
  }, [flows]);

  // A list short enough to fit needs no scrolling, so the sentinel is visible
  // immediately and the gate opens at once. That is correct: it HAS been seen.
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
    ? t('agentflow.import.confirm.title').replace('{{name}}', flows[0].name)
    : t('agentflow.import.confirm.title.many').replace('{{count}}', String(flows.length));

  return (
    <AppModal
      opened
      onClose={onCancel}
      title={title}
      icon={hasRisk ? <ShieldAlert size={16} /> : undefined}
      size="lg"
      zIndex={210}
    >
      <Stack gap="md">
        <Text fz="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
          {t('agentflow.import.confirm.intro')}
        </Text>

        {analyses.map(({ flow, caps }) => (
            <Stack key={flow.id} gap="xs">
              {flows.length > 1 && <Text fz="sm" fw={600}>{flow.name}</Text>}

              {caps.hasRisk && (
                <Box
                  p="xs"
                  style={{
                    background: 'var(--mantine-color-red-light)',
                    borderRadius: 'var(--mantine-radius-md)',
                    border: '1px solid var(--mantine-color-red-filled)',
                  }}
                >
                  <Stack gap={4}>
                    <Group gap={6} align="center">
                      <TriangleAlert size={14} color="var(--mantine-color-red-filled)" />
                      <Text fz="sm" fw={600} c="red">{t('agentflow.import.confirm.risk')}</Text>
                    </Group>
                    {caps.risks.map((risk) => (
                      <Text key={risk.kind} fz="xs" c="red">
                        {`• ${t(`agentflow.import.confirm.risk.${risk.kind}`)} — ${
                          t('agentflow.import.confirm.risk.steps').replace('{{steps}}', risk.steps.join(', '))
                        }`}
                      </Text>
                    ))}
                  </Stack>
                </Box>
              )}

              {(caps.access.length > 0 || caps.setup.length > 0) && (
                <Group gap="xs" wrap="wrap">
                  {caps.setup.map((kind) => (
                    <Badge key={kind} variant="light" size="sm" radius="sm">
                      {t(`agentflow.import.confirm.setup.${kind}`)}
                    </Badge>
                  ))}
                  {caps.access.map((kind) => (
                    <Badge key={kind} variant="default" size="sm" radius="sm">
                      {t(`agentflow.import.confirm.access.${kind}`)}
                    </Badge>
                  ))}
                </Group>
              )}

              <Text fz="xs" c="dimmed">
                {t('agentflow.import.confirm.steps').replace('{{count}}', String(flow.steps.length))}
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
          <Text fz="xs" c="orange">{t('agentflow.import.confirm.scrollHint')}</Text>
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
            {hasRisk ? t('agentflow.import.confirm.acceptRisk') : t('agentflow.import.confirm.accept')}
          </Button>
        </Group>
      </Stack>
    </AppModal>
  );
};
