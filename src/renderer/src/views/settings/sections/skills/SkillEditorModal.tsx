import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Group, Stack, Text } from '@mantine/core';
import { FileText, TriangleExclamationPoint } from 'lucide-react';
import { AppModal } from '../../../../components/AppModal';
import { AppButton } from '../../../../components/AppButton';
import { StatusLine } from '../../components';
import { skillsApi } from '../../../../api/electronApi';
import { Z_MODAL } from '../../../../config/zLayers';
import { skillIssueText } from './skillText';
import { SkillAiBar } from './SkillAiBar';
import { SkillTryBox } from './SkillTryBox';
import { SkillFileTabs } from './SkillFileTabs';
import { SkillQuestions } from './SkillQuestions';
import { SkillDraftDiff } from './SkillDraftDiff';
import { SkillReport, reportHasProblems } from './SkillReport';
import { useSkillDraft } from './useSkillDraft';
import { activeFile, applyDraft, isPristineFiles, skillAiMode } from './skillEditorModel';
import { SKILL_FILE, skillTemplate } from '../../../../../../shared/agentSkills';
import type { SkillSaveResult } from '../../../../../../shared/agentSkills';
import type { SkillOtherFile, SkillTextFiles } from '../../../../../../shared/skillAuthoring';

/**
 * Which skill the editor has open: an installed one (`test`: run its checks as it opens, the row's
 * "Run tests…"), a new one, or a new one drafted from a conversation (the chat ⋮ "Save as skill").
 */
export type SkillEditTarget =
  | { kind: 'edit'; name: string; test?: boolean }
  | { kind: 'new' }
  | { kind: 'conversation'; path: string };

interface Props {
  target: SkillEditTarget | null;
  onClose: () => void;
  t: (key: string) => string;
}

type SaveIssue = Extract<SkillSaveResult, { ok: false }>['issue'];

/**
 * A skill's text files, the way every other tool keeps a skill: what is saved here is what an
 * export carries. AI can write or change them, but only into the editor: a change to text the user
 * typed is shown file by file to apply or discard. The checks run here, on this computer; a fix or
 * a try on the chosen model happens only when asked. Nothing is saved until Save.
 */
export const SkillEditorModal: React.FC<Props> = ({ target, onClose, t }) => {
  const [files, setFiles] = useState<SkillTextFiles>({});
  const [others, setOthers] = useState<SkillOtherFile[]>([]);
  const [active, setActive] = useState<string>(SKILL_FILE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveIssue | null>(null);
  const [modelUrl, setModelUrl] = useState('');
  const [request, setRequest] = useState('');
  const [testing, setTesting] = useState(false);
  const [tryBusy, setTryBusy] = useState(false);
  // Each opening starts the try box afresh.
  const [opening, setOpening] = useState(0);
  // What the editor opened with: while the files still equal it, a draft replaces them outright.
  const openedWith = useRef<SkillTextFiles>({});
  // The files as typed now, for a draft that comes back after the user kept editing.
  const filesNow = useRef(files);
  filesNow.current = files;
  const installed = target?.kind === 'edit' ? target.name : undefined;

  // The files AI wrote here: 檢查 and the fix hold them to the authoring rules, as the draft's own check did.
  const aiWrote = useRef(new Set<string>());

  const isPristine = useCallback(() => isPristineFiles(filesNow.current, openedWith.current), []);
  const takeDraft = useCallback((next: SkillTextFiles, changed: string[]) => {
    for (const rel of changed) aiWrote.current.add(rel);
    setFiles(next);
    setActive(SKILL_FILE);
    setError(null);
  }, []);
  const draft = useSkillDraft({ t, isPristine, onFiles: takeDraft });
  const { reset: resetDraft, run: runDraftRequest, setReport } = draft;
  const modelBusy = draft.drafting || tryBusy;

  const runTest = useCallback(async (forFiles: SkillTextFiles, forOthers: SkillOtherFile[], name?: string): Promise<void> => {
    if (forFiles[SKILL_FILE] === undefined) return;
    setTesting(true);
    try {
      const result = await skillsApi.test({ files: forFiles, others: forOthers, ...(name ? { name } : {}), authored: [...aiWrote.current] });
      if (result.ok) setReport(result.report);
    } finally {
      setTesting(false);
    }
  }, [setReport]);

  useEffect(() => {
    resetDraft();
    aiWrote.current = new Set();
    setError(null);
    setRequest('');
    setActive(SKILL_FILE);
    setOthers([]);
    if (!target) return;
    setOpening((count) => count + 1);
    let live = true;
    void skillsApi.draftModel().then((url) => { if (live) setModelUrl((current) => current || url); });
    if (target.kind === 'new') {
      const template = skillTemplate(
        'my-skill',
        t('settings.skills.template.description'),
        t('settings.skills.template.heading'),
        t('settings.skills.template.instructions'),
      );
      openedWith.current = { [SKILL_FILE]: template };
      setFiles({ [SKILL_FILE]: template });
    } else if (target.kind === 'conversation') {
      // "Save as skill" means "draft it": the draft starts as the dialog opens.
      openedWith.current = {};
      setFiles({});
      void skillsApi.draftModel().then((url) => {
        if (live) void runDraftRequest({ mode: 'conversation', conversationPath: target.path, providerUrl: url });
      });
    } else {
      openedWith.current = {};
      setFiles({});
      void skillsApi.read(target.name).then((view) => {
        if (!live) return;
        const opened = view?.files ?? {};
        openedWith.current = opened;
        setFiles(opened);
        setOthers(view?.others ?? []);
        if (target.test && view) void runTest(view.files, view.others, target.name);
      });
    }
    return () => { live = false; };
  }, [target, t, resetDraft, runDraftRequest, runTest]);

  const close = (): void => {
    if (modelBusy) void skillsApi.cancelDraft();
    onClose();
  };

  const aiMode = skillAiMode(target?.kind ?? 'new', files, openedWith.current);
  const runDraft = (): void => {
    if (!target) return;
    const sent = aiMode === 'revise'
      ? runDraftRequest({ mode: 'revise', files, others, ...(installed ? { name: installed } : {}), request, providerUrl: modelUrl })
      : aiMode === 'conversation' && target.kind === 'conversation'
        ? runDraftRequest({ mode: 'conversation', conversationPath: target.path, request, providerUrl: modelUrl })
        : runDraftRequest({ mode: 'describe', request, providerUrl: modelUrl });
    void sent.then((ok) => { if (ok) setRequest(''); });
  };
  // "Ask AI to fix": main checks the files again and sends what it finds; the typed request stays.
  const fixDraft = (): void => {
    void runDraftRequest({
      mode: 'revise', files, others, ...(installed ? { name: installed } : {}), request: '', fixProblems: true, authored: [...aiWrote.current], providerUrl: modelUrl,
    });
  };

  const edit = (rel: string, text: string): void => {
    setFiles((current) => ({ ...current, [rel]: text }));
    setError(null);
  };

  const save = async (): Promise<void> => {
    if (!target) return;
    setSaving(true);
    try {
      const result = target.kind === 'edit' ? await skillsApi.save(target.name, files) : await skillsApi.create(files);
      if (result.ok) onClose();
      else setError(result.issue);
    } finally {
      setSaving(false);
    }
  };

  const { proposal, report } = draft;
  const shown = activeFile(files, active);
  const failing = report !== null && (report.issues.some((issue) => issue.level === 'error') || report.runs.some((run) => !run.ok));

  return (
    <AppModal
      opened={target !== null}
      onClose={close}
      title={target?.kind === 'edit' ? target.name : t('settings.skills.new')}
      icon={<FileText size={16} />}
      size="xl"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t('settings.skills.editor.hint')}</Text>
        {target?.kind === 'conversation' && (
          <Alert color="var(--mantine-color-warning)" icon={<TriangleExclamationPoint size={16} />} p="xs">
            <Text fz="var(--font-size-sm)" lh={1.6}>{t('settings.skills.ai.fromConversation')}</Text>
          </Alert>
        )}
        <SkillAiBar
          mode={aiMode}
          request={request}
          onRequest={setRequest}
          modelUrl={modelUrl}
          onModel={setModelUrl}
          drafting={draft.drafting}
          progress={draft.progress}
          blocked={tryBusy}
          error={draft.error}
          onDraft={runDraft}
          onStop={() => { void skillsApi.cancelDraft(); }}
          t={t}
        />
        {draft.questions && (
          <SkillQuestions
            key={draft.questions.questions.join('\n')}
            questions={draft.questions.questions}
            busy={draft.drafting}
            onAnswer={(answers) => draft.answer(answers, false)}
            onAssume={() => draft.answer([], true)}
            t={t}
          />
        )}
        {proposal ? (
          <SkillDraftDiff
            current={files}
            draft={proposal.files}
            changed={proposal.changed}
            onApply={() => {
              for (const rel of proposal.changed) aiWrote.current.add(rel);
              setFiles((current) => applyDraft(current, proposal.files, proposal.changed));
              draft.clearProposal();
              setError(null);
            }}
            onDiscard={() => { draft.clearProposal(); setReport(null); }}
            t={t}
          />
        ) : (
          <SkillFileTabs
            files={files}
            active={shown}
            onActive={setActive}
            onChange={edit}
            others={others}
            {...(installed ? { installed } : {})}
            disabled={draft.drafting && !files[SKILL_FILE]}
            t={t}
          />
        )}
        <SkillReport
          report={report}
          calls={draft.calls}
          testing={testing}
          onTest={() => { void runTest(files, others, installed); }}
          onFix={fixDraft}
          fixDisabled={!modelUrl || modelBusy || proposal !== null || !reportHasProblems(report)}
          t={t}
        />
        <SkillTryBox
          key={`try-${opening}`}
          files={files}
          {...(installed ? { name: installed } : {})}
          modelUrl={modelUrl}
          disabled={draft.drafting}
          onBusy={setTryBusy}
          t={t}
        />
        {error && <StatusLine tone="error">{skillIssueText(error, t)}</StatusLine>}
        {failing && !error && <StatusLine tone="warning">{t('settings.skills.report.saveAnyway')}</StatusLine>}
        <Group justify="flex-end" gap={8}>
          <AppButton variant="default" onClick={close}>{t('dialog.cancel')}</AppButton>
          <AppButton
            loading={saving}
            disabled={!files[SKILL_FILE]?.trim() || proposal !== null || draft.drafting}
            onClick={() => { void save(); }}
          >
            {t('common.save')}
          </AppButton>
        </Group>
      </Stack>
    </AppModal>
  );
};
