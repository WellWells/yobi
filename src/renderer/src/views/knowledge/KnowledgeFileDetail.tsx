import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Box, Group, Loader, Stack, Text } from '@mantine/core';
import { ExternalLink, Sparkles, TriangleExclamationPoint, X } from 'lucide-react';
import { knowledgeApi } from '../../api/electronApi';
import { AiModelMenu } from '../../components/AiModelMenu';
import { AppButton } from '../../components/AppButton';
import { GroupHeader } from '../../components/GroupHeader';
import { ToolbarIconButton } from '../../components/PanelToolbar';
import { findModelOption } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { knowledgeCutLabel } from '../../../../shared/knowledgeStatus';
import type { KnowledgeCut, KnowledgeFile, KnowledgeFileDetail as Detail } from '../../../../shared/knowledgeStatus';
import { parseKbNote } from '../../../../shared/kbNote';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { clampWidth, KB_PANEL_MAX, KB_PANEL_MIN } from './knowledgeColumns';
import { KnowledgeFilePreview } from './KnowledgeFilePreview';
import { knowledgeSummaryStatus, splitKnowledgePath } from './knowledgeFileRows';
import type { KnowledgeRowAnalysis } from './knowledgeFileRows';

const TEXT_STYLE: React.CSSProperties = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 };

/** A key fact as the model writes it ("label: value"): the label muted, the value as printed. */
/** Where reading stopped (or what a summary was written from), said only when it was not the whole file. */
function CutLine({ cut, summary = false, t }: { cut: KnowledgeCut; summary?: boolean; t: (key: string) => string }): React.ReactElement {
  const { key, vars } = knowledgeCutLabel(cut, summary);
  return (
    <Group gap={6} wrap="nowrap" c="var(--warning-text)">
      <TriangleExclamationPoint size={13} style={{ flexShrink: 0 }} />
      <Text fz="var(--font-size-xs)" c="var(--warning-text)">{fillTemplate(t(key), vars)}</Text>
    </Group>
  );
}

function FactLine({ fact }: { fact: string }): React.ReactElement {
  const cut = fact.search(/[:：]/);
  if (cut <= 0) return <Text fz="var(--font-size-sm)">{fact}</Text>;
  return (
    <Group gap={8} wrap="nowrap" align="baseline">
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ flexShrink: 0 }}>{fact.slice(0, cut)}</Text>
      <Text fz="var(--font-size-sm)" style={{ wordBreak: 'break-word' }}>{fact.slice(cut + 1).trim()}</Text>
    </Group>
  );
}

interface KnowledgeFileDetailProps {
  kbId: string;
  file: KnowledgeFile;
  analysis: KnowledgeRowAnalysis | undefined;
  onAnalyze: (rels: string[], model: string) => void;
  onClear: (rels: string[]) => void;
  onClose: () => void;
  /** The panel's width, dragged on its left edge (`knowledgeColumns`, remembered). */
  width: number;
  onResize: (width: number, done: boolean) => void;
  t: (key: string) => string;
}

type PanelTab = 'preview' | 'guide';

/**
 * The side panel for one file, in two views, as a file manager's preview pane: the read-only preview first — the picture, a PDF's pages, other types' text — and
 * the source guide, as NotebookLM's source view (the content analysis — a summary, key topics, key
 * facts; marked when the file changed after it — then the text extracted from the file or by OCR,
 * which is what a search finds). The user can analyse the file again, clear the summary, or open it.
 */
export const KnowledgeFileDetailPanel: React.FC<KnowledgeFileDetailProps> = ({
  kbId, file, analysis, onAnalyze, onClear, onClose, width, onResize, t,
}) => {
  const [tab, setTab] = useState<PanelTab>('preview');
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const { extraModels } = useProviderModels(detail?.aiModel);
  const status = knowledgeSummaryStatus(file, analysis);
  const busy = status === 'running' || status === 'queued';
  const { name } = splitKnowledgePath(file.path);
  const note = useMemo(() => (detail?.ai ? parseKbNote(detail.ai) : null), [detail?.ai]);

  // Read again whenever the file's row changes: a new summary, a re-read after an edit.
  useEffect(() => {
    let live = true;
    void knowledgeApi.fileDetail(kbId, file.path).then((result) => { if (live) setDetail(result); }, () => undefined);
    return () => { live = false; };
  }, [kbId, file.path, file.mtime, file.read, file.ai?.at]);

  const modelLabel = detail?.aiModel ? findModelOption(detail.aiModel, extraModels).label : '';
  const analyzeButton = (
    <AiModelMenu menuLabel={t('kb.analyze.menu.one')} onPick={(url) => onAnalyze([file.path], url)} disabled={busy}>
      <AppButton size="compact-xs" variant="subtle" leftSection={<Sparkles size={12} />} loading={busy}>
        {detail?.ai ? t('kb.analyze.again') : t('kb.analyze.action')}
      </AppButton>
    </AiModelMenu>
  );

  return (
    <Stack
      // A region inside the main landmark (a complementary one may not nest there: axe
      // landmark-complementary-is-top-level) and an F6 stop (WCAG 2.4.1).
      component="section"
      aria-label={t('a11y.c.fileDetail')}
      data-region="panel"
      gap={0}
      w={width}
      h="100%"
      pos="relative"
      style={{ borderLeft: '1px solid var(--mantine-color-default-border)', flexShrink: 0, overflow: 'hidden' }}
    >
      {/* The left edge drags the panel's width, as a file manager's preview pane. */}
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label={t('kb.page.panelResize')}
        pos="absolute"
        top={0}
        bottom={0}
        left={0}
        w={6}
        style={{ cursor: 'col-resize', zIndex: 2, touchAction: 'none' }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start) onResize(clampWidth(start.width + start.x - event.clientX, KB_PANEL_MIN, KB_PANEL_MAX), false);
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (start) onResize(clampWidth(start.width + start.x - event.clientX, KB_PANEL_MIN, KB_PANEL_MAX), true);
        }}
      />
      <Group gap={6} wrap="nowrap" px={14} py={10}>
        <Text fw={600} fz="var(--font-size-md)" truncate="end" flex={1} title={file.path}>{name}</Text>
        <ToolbarIconButton icon={ExternalLink} label={t('kb.page.openFile')} onClick={() => { void knowledgeApi.openFile(kbId, file.path); }} />
        <ToolbarIconButton icon={X} label={t('kb.page.closeDetail')} onClick={onClose} />
      </Group>
      <Box px={14} pb={10}>
        <AppSegmentedControl
          quiet
          size="xs"
          value={tab}
          onChange={(value) => setTab(value === 'guide' ? 'guide' : 'preview')}
          options={[
            { value: 'preview', label: t('kb.page.tab.preview') },
            { value: 'guide', label: t('kb.page.guide') },
          ]}
        />
      </Box>

      <Box flex={1} px={14} pb={14} style={{ overflowY: 'auto' }}>
        {tab === 'preview' ? (
          <KnowledgeFilePreview kbId={kbId} file={file} text={detail?.text || note?.fullText || ''} width={width - 28} t={t} />
        ) : !detail ? (
          <Loader size="sm" />
        ) : (
          <Stack gap={16}>
            {analysis?.state === 'failed' && analysis.error && (
              <Alert color="var(--mantine-color-error)" variant="light" icon={<TriangleExclamationPoint size={16} />}>
                {analysis.error}
              </Alert>
            )}

            <Stack
              gap={10}
              p={14}
              style={{ background: 'var(--mantine-color-default)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)' }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} fz="var(--font-size-md)">{t('kb.page.guide')}</Text>
                <Group gap={4} wrap="nowrap">
                  {analyzeButton}
                  {detail.ai && !busy && (
                    <AppButton size="compact-xs" variant="subtle" color="red" onClick={() => onClear([file.path])}>
                      {t('kb.analyze.clear')}
                    </AppButton>
                  )}
                </Group>
              </Group>
              {file.ai?.stale && (
                <Alert color="var(--mantine-color-warning)" variant="light" icon={<TriangleExclamationPoint size={16} />}>
                  {t('kb.page.summaryStale')}
                </Alert>
              )}
              {!detail.ai ? (
                <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={TEXT_STYLE}>{t('kb.page.guideNone')}</Text>
              ) : !note ? (
                <Text fz="var(--font-size-sm)" style={TEXT_STYLE}>{detail.ai}</Text>
              ) : (
                <>
                  {note.summary && <Text fz="var(--font-size-sm)" style={TEXT_STYLE}>{note.summary}</Text>}
                  {note.topics.length > 0 && (
                    <Group gap={6}>
                      {note.topics.map((topic) => <Badge key={topic} variant="default" size="lg">{topic}</Badge>)}
                    </Group>
                  )}
                  {note.facts.length > 0 && (
                    <Stack gap={4}>
                      <GroupHeader variant="plain" label={t('kb.page.keyFacts')} />
                      {note.facts.map((fact) => <FactLine key={fact} fact={fact} />)}
                    </Stack>
                  )}
                </>
              )}
              {modelLabel && detail.ai && (
                <Text fz="var(--font-size-xs)" c="var(--text-muted)">{fillTemplate(t('kb.page.guideBy'), { model: modelLabel })}</Text>
              )}
              {/* Only when it happened: a summary of the first pages must not read as one of the whole file. */}
              {detail.ai && detail.aiCut && <CutLine cut={detail.aiCut} summary t={t} />}
            </Stack>

            <Stack gap={6}>
              <GroupHeader variant="plain" label={t(file.read === 'ocr' ? 'kb.page.ocrText' : file.read === 'ocrPartial' ? 'kb.page.ocrPartialText' : 'kb.page.ownText')} />
              {detail.cut && <CutLine cut={detail.cut} t={t} />}
              {detail.text || note?.fullText ? (
                <Text fz="var(--font-size-sm)" c="var(--text-secondary)" style={TEXT_STYLE}>{detail.text || note?.fullText}</Text>
              ) : (
                <Text fz="var(--font-size-sm)" c="var(--text-muted)">
                  {file.read === 'pending' ? t('kb.page.reading') : t('kb.page.noText')}
                </Text>
              )}
            </Stack>
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
