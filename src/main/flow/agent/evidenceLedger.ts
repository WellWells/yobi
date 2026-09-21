import type {
  ActionOutcome, Fact, FailureClass, LedgerView, OutcomeNotice, ToolRisk, VerificationResult,
} from './toolContracts';

/**
 * One non-read call the model proposed, and everything that decided and followed it. Persisted on
 * the run, so the next turn in the conversation reads what really happened instead of the prose the
 * model wrote about it — the prose is how "已成功儲存草稿" became a fact three turns in a row.
 */
export interface ActionRecord {
  runId: string;
  step: number;
  serverId: string;
  server: string;
  tool: string;
  /** Long strings clipped, so a record stays small enough to persist and to re-check later. */
  args: Record<string, unknown>;
  risk: ToolRisk;
  targetKey: string | null;
  signature: string;
  label: string;
  at: string;
  verdict: 'ready' | 'blocked';
  reasons?: { code: string; message: string }[];
  confirmed?: 'auto' | 'approved' | 'denied';
  outcome?: ActionOutcome;
  failure?: FailureClass;
  summary?: string;
  notice?: OutcomeNotice;
  verification?: VerificationResult;
}

export interface EvidenceSnapshot {
  facts: Fact[];
  actions: ActionRecord[];
  observations?: string[];
  userWords?: string;
}

export interface EvidenceLedger extends LedgerView {
  add: (facts: readonly Fact[]) => void;
  addObservation: (text: string) => void;
  addUserWords: (text: string) => void;
  /** This run's records. */
  actions: ActionRecord[];
  /** Records from earlier runs in the same conversation, oldest first. */
  priorActions: readonly ActionRecord[];
  /** Earlier records this run has already re-checked, so the prior-action rule holds a call back once. */
  checked: Set<string>;
  absorb: (snapshot: EvidenceSnapshot) => void;
  /** Observations are left out unless asked for: a persisted run already holds them in its turns. */
  snapshot: (withObservations?: boolean) => EvidenceSnapshot;
}

/** Below this length a value is too short to be an invented handle worth refusing. */
const MIN_CHECKED_VALUE = 6;
const MAX_OBSERVATION_CHARS = 600_000;
const MAX_PERSISTED_FACTS = 400;
const MAX_PRIOR_OBSERVATIONS = 60;

export function actionId(record: Pick<ActionRecord, 'runId' | 'step'>): string {
  return `${record.runId}#${record.step}`;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/[-\s]/g, '');
}

export function createLedger(userWords: string, prior?: EvidenceSnapshot): EvidenceLedger {
  const facts = new Map<string, Fact>();
  const observations: string[] = [];
  let observedChars = 0;
  let words = userWords;
  const priorActions: ActionRecord[] = [];

  const add = (incoming: readonly Fact[]): void => {
    for (const fact of incoming) {
      const id = `${fact.kind}:${fact.key.toLowerCase()}`;
      const existing = facts.get(id);
      // Runtime facts describe the user's own configuration; a later tool row about the same key
      // may add fields but must not downgrade where the fact came from.
      const source = existing?.source === 'runtime' ? 'runtime' : fact.source;
      facts.delete(id);
      facts.set(id, { ...fact, source, fields: { ...existing?.fields, ...fact.fields } });
    }
  };

  const addObservation = (text: string): void => {
    if (!text) return;
    observations.push(text);
    observedChars += text.length;
    while (observedChars > MAX_OBSERVATION_CHARS && observations.length > 1) {
      observedChars -= observations.shift()!.length;
    }
  };

  const haystacks = (): string[] => [words, ...observations];

  const ledger: EvidenceLedger = {
    get userWords() { return words; },
    actions: [],
    get priorActions() { return priorActions; },
    checked: new Set<string>(),
    add,
    addObservation,
    addUserWords: (text) => { if (text.trim()) words = `${words}\n${text}`; },
    facts: (kind) => [...facts.values()].filter((fact) => fact.kind === kind),
    fact: (kind, key) => facts.get(`${kind}:${key.toLowerCase()}`),
    hasValue: (raw) => {
      const value = raw.trim();
      if (value.length < MIN_CHECKED_VALUE) return true;
      const sources = haystacks();
      if (sources.some((text) => text.includes(value))) return true;
      const lower = value.toLowerCase();
      if (sources.some((text) => text.toLowerCase().includes(lower))) return true;
      // Hyphenless UUIDs: a server returns `1a2b-…` and the model hands back `1a2b…`.
      if (value.length < 20) return false;
      const squashed = squash(value);
      return sources.some((text) => squash(text).includes(squashed));
    },
    absorb: (snapshot) => {
      add(snapshot.facts);
      for (const text of snapshot.observations ?? []) addObservation(text);
    },
    snapshot: (withObservations = false) => ({
      facts: [...facts.values()].slice(-MAX_PERSISTED_FACTS),
      actions: [...ledger.actions],
      ...(withObservations ? { observations: [...observations] } : {}),
    }),
  };

  if (prior) {
    add(prior.facts);
    priorActions.push(...prior.actions);
    for (const text of (prior.observations ?? []).slice(-MAX_PRIOR_OBSERVATIONS)) addObservation(text);
    if (prior.userWords) ledger.addUserWords(prior.userWords);
  }
  return ledger;
}

/** Every record the prior-action and repeat rules may look back at, newest last. */
export function allActions(ledger: EvidenceLedger): ActionRecord[] {
  return [...ledger.priorActions, ...ledger.actions];
}

/** Merges the evidence of several earlier runs into one prior snapshot, oldest run first. */
export function mergeSnapshots(snapshots: readonly EvidenceSnapshot[]): EvidenceSnapshot {
  return {
    facts: snapshots.flatMap((snapshot) => snapshot.facts),
    actions: snapshots.flatMap((snapshot) => snapshot.actions),
    observations: snapshots.flatMap((snapshot) => snapshot.observations ?? []),
    userWords: snapshots.map((snapshot) => snapshot.userWords ?? '').filter(Boolean).join('\n'),
  };
}
