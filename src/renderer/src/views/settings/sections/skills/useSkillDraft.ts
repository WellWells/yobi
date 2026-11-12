import { useCallback, useEffect, useRef, useState } from 'react';
import { skillsApi } from '../../../../api/electronApi';
import type { SkillDraftRequest, SkillDraftResult, SkillTextFiles, SkillVerifyReport } from '../../../../../../shared/skillAuthoring';
import { applyDraftStep, finishDraftProgress, startDraftProgress } from './skillDraftProgressModel';
import type { DraftOutcome, DraftProgress } from './skillDraftProgressModel';

/** The draft's questions, waiting for the user's answers; the request goes again with them. */
export interface PendingQuestions {
  questions: string[];
  calls: number;
  request: SkillDraftRequest;
}

/** A draft over files the user had typed: shown file by file before it goes in. */
export interface DraftProposal {
  files: SkillTextFiles;
  changed: string[];
}

function draftError(result: Extract<SkillDraftResult, { ok: false }>, mode: SkillDraftRequest['mode'], t: (key: string) => string): string | null {
  if (result.reason === 'cancelled') return null;
  // Only a conversation draft is refused for its source; any other refusal reads as "no usable skill".
  if (result.reason === 'invalid' && mode === 'conversation') return t('settings.skills.ai.unreadable');
  return result.error ?? t('settings.skills.ai.invalidOutput');
}

function outcomeOf(result: SkillDraftResult): DraftOutcome {
  if (!result.ok) return result.reason === 'cancelled' ? 'stopped' : 'failed';
  return result.kind === 'questions' ? 'questions' : 'done';
}

let draftCount = 0;

interface Options {
  t: (key: string) => string;
  /** Whether the editor still holds what it opened with: then a draft goes straight in. */
  isPristine: () => boolean;
  /** A draft that goes straight in: all of its files, and which of them AI wrote or changed. */
  onFiles: (files: SkillTextFiles, changed: string[]) => void;
}

/**
 * One draft from request to editor: the first call, the questions round if the model asked any,
 * and the result (files, the local checks, the calls it spent). Nothing is saved here.
 */
export function useSkillDraft({ t, isPristine, onFiles }: Options) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PendingQuestions | null>(null);
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  const [report, setReport] = useState<SkillVerifyReport | null>(null);
  const [calls, setCalls] = useState<number | null>(null);
  const [progress, setProgress] = useState<DraftProgress | null>(null);
  // A reply that lands after the dialog closed or reopened is dropped.
  const generation = useRef(0);
  // The draft whose steps are shown: steps of an older one are dropped.
  const draftId = useRef('');

  useEffect(() => skillsApi.onDraftProgress((payload) => {
    if (!draftId.current || payload.draftId !== draftId.current) return;
    setProgress((current) => (current ? applyDraftStep(current, payload.step, Date.now()) : current));
  }), []);

  const run = useCallback(async (request: SkillDraftRequest): Promise<boolean> => {
    const mine = generation.current;
    draftCount += 1;
    const id = `draft-${Date.now()}-${draftCount}`;
    draftId.current = id;
    let outcome: DraftOutcome = 'failed';
    setDrafting(true);
    setError(null);
    setQuestions(null);
    setProgress(startDraftProgress(Date.now()));
    try {
      const result = await skillsApi.draft({ ...request, draftId: id });
      if (mine !== generation.current) return false;
      outcome = outcomeOf(result);
      if (!result.ok) {
        setError(draftError(result, request.mode, t));
        return false;
      }
      setCalls(result.calls);
      if (result.kind === 'questions') {
        setQuestions({ questions: result.questions, calls: result.calls, request });
        return true;
      }
      setReport(result.report);
      if (isPristine()) onFiles(result.files, result.changed);
      else setProposal({ files: result.files, changed: result.changed });
      return true;
    } finally {
      if (mine === generation.current) {
        setDrafting(false);
        if (draftId.current === id) setProgress((current) => (current ? finishDraftProgress(current, outcome, Date.now()) : current));
      }
    }
  }, [t, isPristine, onFiles]);

  /** The second call: the questions with the answers, or "write it with your assumptions". */
  const answer = useCallback((answers: string[], useAssumptions: boolean): void => {
    if (!questions) return;
    const { questions: asked, calls: spent, request } = questions;
    void run({ ...request, prior: { questions: asked, answers, calls: spent, useAssumptions } });
  }, [questions, run]);

  const reset = useCallback((): void => {
    generation.current += 1;
    draftId.current = '';
    setProgress(null);
    setDrafting(false);
    setError(null);
    setQuestions(null);
    setProposal(null);
    setReport(null);
    setCalls(null);
  }, []);

  return {
    drafting, error, questions, proposal, report, calls, progress,
    run, answer, reset, setReport, setError,
    clearProposal: () => setProposal(null),
  };
}
