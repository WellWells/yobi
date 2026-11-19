/**
 * The AI description of a knowledge-base file, on the user's request, with the model they pick:
 * local OCR runs in the background, a model reads only the files the user chooses — the whole
 * folder is never sent on its own. The description — what the document is, a summary, the exact
 * facts (names, amounts, dates, numbers), search terms, and for a scan or picture its full text —
 * is stored in the index next to the file's own text and answers searches with it.
 *
 * What the model is given: a file with text of its own goes as that text (cheaper, and any model
 * reads it); a scan or a picture goes as the file — uploaded to a website model, as page pictures
 * to an API key that reads pictures. A model that can do neither for that file is refused up front
 * with a reason, not sent a prompt it cannot answer.
 *
 * One file at a time, in the order asked: a website model has one browser window, and a queue that
 * runs one by one is what the page shows.
 */
import * as path from 'node:path';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import { readKnowledgeCut } from '../../shared/knowledgeStatus';
import type { KnowledgeAnalysisEvent, KnowledgeCut } from '../../shared/knowledgeStatus';
import { fenceUntrusted } from '../../shared/promptFencing';
import { KB_NOTE_SECTIONS } from '../../shared/kbNote';
import { chunkDocument } from './kbChunk';
import type { KbIndex } from './kbIndex';

/** Own text sent to the model, at most: the description is about the document, not a copy of it. */
export const KB_ANALYZE_TEXT_MAX = 60_000;
/** Pages of a scan sent to an API key as pictures. */
export const KB_ANALYZE_PAGES_MAX = 5;
/** The description kept, at most (a scan's full text is in it). */
export const KB_AI_TEXT_MAX = 200_000;

/** What the model gets for one file. */
export type AnalyzeInput =
  | { kind: 'text'; text: string }
  | { kind: 'file'; attachments: string[] }
  | { kind: 'images'; files: string[] };

/** The reason a model cannot read a file (an i18n key), or null when it can. */
export type AnalyzeRefusal = 'kb.analyze.error.noUpload' | 'kb.analyze.error.noImages' | null;

/** The failures this module names itself: i18n keys, shown in the user's language. */
export const KB_ANALYZE_ERROR_KEYS = [
  'kb.analyze.error.noUpload', 'kb.analyze.error.noImages', 'kb.analyze.error.gone', 'kb.analyze.error.notReady', 'kb.analyze.error.empty',
] as const;

export interface ModelAbilities {
  /** A website model (not an API key). */
  web: boolean;
  /** A website model that takes uploads (not Perplexity). */
  uploads: boolean;
  /** An API key that reads pictures. */
  images: boolean;
  /** PDF pages can be drawn as pictures here (Windows). */
  renderPdf: boolean;
}

/** How a file goes to a model, or why it cannot: own text first, then the file, then page pictures. */
export function planAnalyzeInput(file: string, ownText: string, model: ModelAbilities): { input: 'text' | 'file' | 'images' } | { refused: Exclude<AnalyzeRefusal, null> } {
  if (ownText.trim()) return { input: 'text' };
  if (model.uploads) return { input: 'file' };
  const isPdf = path.extname(file).toLowerCase() === '.pdf';
  if (model.images && (!isPdf || model.renderPdf)) return { input: 'images' };
  return { refused: model.web ? 'kb.analyze.error.noUpload' : 'kb.analyze.error.noImages' };
}

/** The prompt: English, structure only, the document fenced (it is not the user's instruction). */
export function analyzePrompt(fileName: string, language: string, text: string | null): string {
  const source = text === null
    ? 'DOCUMENT: the attached file (a scan or picture: read it from the image).'
    : `DOCUMENT (its text, already extracted):\n${fenceUntrusted('document', text)}`;
  return [
    `TASK: Write a source guide for the document "${fileName}": what it is and what it says, so it can be found by search later and questions can be answered from it.`,
    source,
    'OUTPUT RULES (critical):',
    `- Write in ${language}. Plain text, no Markdown, no preamble or closing remarks.`,
    `- Five sections, in this order, each starting with its label on its own line: ${KB_NOTE_SECTIONS.map((label) => `${label}:`).join(', ')}`,
    '- SUMMARY: one paragraph of 2 to 5 sentences: the kind of document, who issued it and for whom, the date or period it covers, its purpose and main content.',
    '- KEY TOPICS: 3 to 6 short noun phrases naming the main subjects, one per line.',
    '- KEY FACTS: one per line as "label: value": names, organisations, amounts with currency, dates, account and ID numbers, exactly as printed.',
    '- SEARCH TERMS: words someone would use to look for this document, with synonyms and common other names, comma-separated.',
    '- FULL TEXT: for a scan or picture, its text transcribed as printed, numbers exact; when the document text was given above, write only "-".',
    '- Only what the document says: never guess a value that is not in it.',
  ].join('\n');
}

export interface AnalyzeJob {
  kbId: string;
  path: string;
  model: string;
}

export interface AnalyzeDeps {
  findKb: (id: string) => KnowledgeBase | undefined;
  index: (kb: KnowledgeBase) => KbIndex;
  /** The file inside the base, or null (gone, or outside the folder). */
  resolve: (kb: KnowledgeBase, rel: string) => string | null;
  abilities: (model: string) => ModelAbilities;
  /** Draws a PDF's first pages as pictures; the caller removes them after. */
  /** `pages` = the document's page count, when known: more than `files` = only the first pages went. */
  renderPages: (file: string, maxPages: number, signal: AbortSignal) => Promise<{ files: string[]; pages?: number; cleanup: () => void }>;
  /** Sends the prompt with the input to the model; the model's answer. */
  ask: (model: string, prompt: string, input: AnalyzeInput, signal: AbortSignal) => Promise<string>;
  language: () => string;
  /** The user-facing words for a failure (`localizeUserFacingError`, or an i18n key). */
  describeError: (error: unknown) => string;
  emit: (event: KnowledgeAnalysisEvent) => void;
  /** The index changed: the status (unreadable count) is republished. */
  stored: (kb: KnowledgeBase) => void;
  log: (line: string) => void;
}

export class KbAnalyzeQueue {
  private readonly jobs: AnalyzeJob[] = [];
  private current: { job: AnalyzeJob; controller: AbortController } | null = null;

  constructor(private readonly deps: AnalyzeDeps) {}

  private same(a: AnalyzeJob, kbId: string, rel: string): boolean {
    return a.kbId === kbId && a.path === rel;
  }

  /** Queues each file once (asking again with another model replaces the waiting one). */
  add(kbId: string, rels: readonly string[], model: string): void {
    for (const rel of rels) {
      if (this.current && this.same(this.current.job, kbId, rel)) continue;
      const waiting = this.jobs.findIndex((job) => this.same(job, kbId, rel));
      if (waiting >= 0) this.jobs.splice(waiting, 1);
      this.jobs.push({ kbId, path: rel, model });
      this.deps.emit({ kbId, path: rel, state: 'queued' });
    }
    void this.pump();
  }

  /** Cancels these files (all of the base's when `rels` is empty): waiting ones leave, the running one stops. */
  cancel(kbId: string, rels: readonly string[] = []): void {
    const hit = (job: AnalyzeJob): boolean => job.kbId === kbId && (rels.length === 0 || rels.includes(job.path));
    for (let i = this.jobs.length - 1; i >= 0; i -= 1) {
      const job = this.jobs[i];
      if (!job || !hit(job)) continue;
      this.jobs.splice(i, 1);
      this.deps.emit({ kbId, path: job.path, state: 'cancelled' });
    }
    if (this.current && hit(this.current.job)) this.current.controller.abort();
  }

  /** What is waiting or running, for a page opened mid-queue. */
  pending(kbId: string): KnowledgeAnalysisEvent[] {
    const running = this.current?.job.kbId === kbId ? [{ kbId, path: this.current.job.path, state: 'running' as const }] : [];
    return [...running, ...this.jobs.filter((job) => job.kbId === kbId).map((job) => ({ kbId, path: job.path, state: 'queued' as const }))];
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const job = this.jobs.shift();
    if (!job) return;
    const controller = new AbortController();
    this.current = { job, controller };
    this.deps.emit({ kbId: job.kbId, path: job.path, state: 'running' });
    try {
      await this.run(job, controller.signal);
      this.deps.emit({ kbId: job.kbId, path: job.path, state: 'done' });
    } catch (err) {
      if (controller.signal.aborted) {
        this.deps.emit({ kbId: job.kbId, path: job.path, state: 'cancelled' });
      } else {
        this.deps.log(`⚠️ [KB] AI description of "${job.path}" failed: ${err instanceof Error ? err.message : String(err)}`);
        this.deps.emit({ kbId: job.kbId, path: job.path, state: 'failed', error: this.deps.describeError(err) });
      }
    } finally {
      this.current = null;
      void this.pump();
    }
  }

  private async run(job: AnalyzeJob, signal: AbortSignal): Promise<void> {
    const kb = this.deps.findKb(job.kbId);
    if (!kb) throw new Error('kb.analyze.error.gone');
    const file = this.deps.resolve(kb, job.path);
    if (!file) throw new Error('kb.analyze.error.gone');
    const index = this.deps.index(kb);
    // The description is stored on the file's index row: a file just added is read first.
    const row = index.fileByPath(job.path);
    if (!row) throw new Error('kb.analyze.error.notReady');
    // The version read now is the one the answer describes, however long the model takes.
    const readMtime = row.mtime;
    const ownText = index.ownText(job.path, KB_ANALYZE_TEXT_MAX);
    const plan = planAnalyzeInput(file, ownText, this.deps.abilities(job.model));
    if ('refused' in plan) throw new Error(plan.refused);
    const name = path.basename(file);
    let answer: string;
    // What the summary saw, when it was not the whole file: shown on the source guide.
    let cut: KnowledgeCut | undefined;
    if (plan.input === 'text') {
      cut = readKnowledgeCut({ chars: ownText.length, total: row.chars + 2 * Math.max(0, row.chunks - 1) });
      answer = await this.deps.ask(job.model, analyzePrompt(name, this.deps.language(), ownText), { kind: 'text', text: ownText }, signal);
    } else if (plan.input === 'file') {
      answer = await this.deps.ask(job.model, analyzePrompt(name, this.deps.language(), null), { kind: 'file', attachments: [file] }, signal);
    } else {
      const isPdf = path.extname(file).toLowerCase() === '.pdf';
      const pages = isPdf ? await this.deps.renderPages(file, KB_ANALYZE_PAGES_MAX, signal) : { files: [file], cleanup: () => undefined };
      if (isPdf && pages.pages) cut = readKnowledgeCut({ page: pages.files.length, pages: pages.pages });
      try {
        answer = await this.deps.ask(job.model, analyzePrompt(name, this.deps.language(), null), { kind: 'images', files: pages.files }, signal);
      } finally {
        pages.cleanup();
      }
    }
    const text = answer.trim().slice(0, KB_AI_TEXT_MAX);
    if (!text) throw new Error('kb.analyze.error.empty');
    if (signal.aborted) return;
    index.setAi(job.path, text, chunkDocument(`${name} › Summary`, text), job.model, Date.now(), readMtime, cut);
    this.deps.stored(kb);
    this.deps.log(`📚 [KB] AI description of "${job.path}" stored (${text.length} chars)`);
  }
}
