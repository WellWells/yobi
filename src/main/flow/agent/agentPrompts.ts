import { isByokTargetUrl } from '../../../shared/types';
import { formatPromptDateWithWeekday } from '../../../shared/promptDate';
import { fenceUntrusted } from '../../../shared/promptFencing';
import { preparePromptForProvider } from '../../providers';

/**
 * One completed step of an agent run. `deltaObservation` is the loosely-capped copy sent
 * as a follow-up on a live provider thread, where the message owns the whole budget;
 * `observation` is the tightly-capped copy that has to share the self-contained prompt.
 */
export interface ScratchEntry {
  thought: string;
  tool: string;
  config: Record<string, string>;
  observation: string;
  deltaObservation?: string;
}

export const SCRATCH_IN_PROMPT = 6;
export const SCRATCH_IN_PROMPT_MCP = 5;
export const SCRATCH_TOTAL_BUDGET = 48_000;

/**
 * The run's own checklist. `steps` is written once and never rewritten — a model allowed to
 * restate its plan mid-run will quietly shrink it to whatever it has already done — and
 * `done` accumulates the 1-based indices it reports finishing.
 */
export interface AgentPlan {
  steps: string[];
  done: number[];
}

/**
 * The plan is re-rendered into every prompt, so its worst case has to be part of
 * INSTRUCTION_EST — which is why the caps are tight and match the 2-4 sub-goals the prompt
 * asks for, rather than being generous limits that quietly cost a byte-capped provider its
 * conversation history.
 */
const MAX_PLAN_STEPS = 4;
const MAX_PLAN_STEP_CHARS = 100;

export function emptyPlan(): AgentPlan {
  return { steps: [], done: [] };
}

/**
 * Reads the optional plan fields off a decision. Deliberately total: anything malformed is
 * dropped rather than reported, because a plan is bookkeeping and must never be the reason
 * an otherwise valid action is rejected — that would trade real progress for tidy metadata.
 */
export function readPlanFields(json: unknown): { plan?: string[]; planDone?: number[] } {
  if (typeof json !== 'object' || json === null) return {};
  const obj = json as Record<string, unknown>;

  const steps = Array.isArray(obj.plan)
    ? obj.plan
        .filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
        .map((step) => step.trim().slice(0, MAX_PLAN_STEP_CHARS))
        .slice(0, MAX_PLAN_STEPS)
    : [];

  const doneSource = Array.isArray(obj.plan_done) ? obj.plan_done
    : Array.isArray((obj as { planDone?: unknown }).planDone) ? (obj as { planDone: unknown[] }).planDone
    : [];
  const done = Array.from(new Set(
    doneSource
      .map((value) => (typeof value === 'number' ? value : Number.parseInt(String(value), 10)))
      .filter((value) => Number.isInteger(value) && value >= 1),
  )).sort((a, b) => a - b);

  return {
    ...(steps.length > 0 ? { plan: steps } : {}),
    ...(done.length > 0 ? { planDone: done } : {}),
  };
}

/** Merges a decision's plan fields into the run's plan, in place. */
export function applyPlanUpdate(plan: AgentPlan, steps?: string[], done?: number[]): void {
  if (plan.steps.length === 0 && steps && steps.length > 0) plan.steps = [...steps];
  if (!done) return;
  for (const index of done) {
    if (index <= plan.steps.length && !plan.done.includes(index)) plan.done.push(index);
  }
  plan.done.sort((a, b) => a - b);
}

export function planComplete(plan: AgentPlan): boolean {
  return plan.steps.length > 0 && plan.done.length >= plan.steps.length;
}

export function renderPlan(plan: AgentPlan): string[] {
  if (plan.steps.length === 0) return [];
  return [
    'YOUR PLAN (you wrote this; keep "plan_done" up to date):',
    ...plan.steps.map((step, index) => `  [${plan.done.includes(index + 1) ? 'x' : ' '}] ${index + 1}. ${step}`),
  ];
}

/**
 * What `buildTurnPrompt` costs before any catalog, goal, history or observation is added.
 * Everything that competes for a capped provider's input — the conversation history and the
 * MCP catalog — is budgeted by subtracting this, so it is the single source of truth for
 * both and MUST NOT be re-typed by either. Sized for the worst case (every optional rule
 * block present) and pinned by `test/agentPromptBudget.test.ts`, because under-estimating
 * it does not truncate the prompt — it silently drops the whole history instead.
 *
 * The slack over the measured worst case also has to cover the environment line, whose
 * timezone and locale are read from the running machine: the estimate is pinned wherever the
 * test happens to run, so it must already hold on a machine with the longest names the
 * clamps allow.
 */
/*
 * Raised 5,100 → 5,700 for the capability-check rule and the precedence block. The cost is paid
 * by the MCP catalog, which is sized as "the cap minus this" with no floor of its own; the
 * conversation history is unaffected because its own 12,000 ceiling binds first
 * (33,499 − 5,700 − 1,200 = 26,599, still far above it). Both are pinned by
 * test/agentPromptBudget.test.ts.
 */
export const INSTRUCTION_EST = 5_700;

function renderScratchEntry(entry: ScratchEntry, step: number): string {
  return [
    `[${step}] thought: ${entry.thought}`,
    `    called: ${entry.tool} ${JSON.stringify(entry.config)}`,
    `    observation: ${entry.observation || '(empty)'}`,
  ].join('\n');
}

/**
 * Exported for the test suite. The per-observation caps bound a single tool result, but
 * nothing bounded their sum: on BYOK six observations at the 16k cap meant re-sending
 * ~96k characters on every turn, of a prompt that is already re-sent in full because the
 * API is stateless. Filling newest-first inside a total budget keeps the freshest evidence
 * whole and drops the oldest, which is the same trade `packReplayPrompt` makes for chat.
 */
export function renderScratch(
  scratch: ScratchEntry[],
  scratchSlots: number = SCRATCH_IN_PROMPT,
  totalBudget: number = SCRATCH_TOTAL_BUDGET,
): string {
  if (scratch.length === 0) return 'STEPS TAKEN SO FAR: (none yet)';
  const windowed = scratch.slice(-scratchSlots);
  const firstStep = scratch.length - windowed.length + 1;

  const lines: string[] = [];
  let used = 0;
  for (let index = windowed.length - 1; index >= 0; index--) {
    const line = renderScratchEntry(windowed[index], firstStep + index);
    // The newest entry always goes in, even when it alone exceeds the budget — a turn with
    // no observation at all cannot make progress.
    if (lines.length > 0 && used + line.length > totalBudget) break;
    lines.unshift(line);
    used += line.length;
  }

  const omitted = scratch.length - lines.length;
  const header = omitted > 0
    ? `STEPS TAKEN SO FAR (showing the last ${lines.length} of ${scratch.length}):`
    : 'STEPS TAKEN SO FAR:';
  // Fenced because an observation is whatever a web page said. Everything above this point
  // is Yobi's own text; everything inside the tag was written by someone else.
  return [header, fenceUntrusted('steps', lines.join('\n'))].join('\n');
}

/**
 * Clamped because the block is part of INSTRUCTION_EST: the estimate is pinned on one
 * machine, and a user in `America/Argentina/ComodRivadavia` must not be able to widen the
 * prompt past what every other budget was computed against.
 */
const ENV_TIMEZONE_MAX = 40;
const ENV_LOCALE_MAX = 20;

/**
 * The one fact the model cannot recover from anything else in the prompt. Without it a
 * time-relative goal ("the latest", "this year") is resolved against the model's training
 * cutoff and a place-relative one ("the weather", "the market") against nothing at all.
 * Browser providers inject a date of their own; BYOK endpoints do not, which is where this
 * earns its bytes.
 */
export function envContextLine(now: Date = new Date()): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const timezone = (resolved.timeZone || 'unknown').slice(0, ENV_TIMEZONE_MAX);
  const locale = (resolved.locale || 'unknown').slice(0, ENV_LOCALE_MAX);
  return `CONTEXT: today is ${formatPromptDateWithWeekday(now)}, timezone ${timezone}, system locale ${locale}.`;
}

function renderEnvironment(): string[] {
  return [
    envContextLine(),
    'Resolve anything time-relative ("latest", "this year") or place-relative ("the weather",',
    '"the market") in the GOAL against these — never assume a date or a country from memory.',
  ];
}

const APPROACH_FULL: readonly string[] = [
  'HOW TO APPROACH THE GOAL:',
  '- Treat the GOAL as a task to PERFORM with your TOOLS, not a question to answer from memory.',
  '  If a TOOL can do it, USE it — e.g. a request to summarize a YouTube video → call the "youtube"',
  '  tool on the URL to get the transcript, then synthesize the summary yourself.',
  '- A GOAL that asks you to look something up on the web deserves DEPTH, not one lookup. Split it',
  '  into 2-4 distinct sub-questions, call "research" once per sub-question, then synthesize across',
  '  the results. "research" plans its own queries, reads the pages and cites them in a single step',
  '  — it is the tool for anything needing evidence; "search" only hands you links to read yourself.',
  '- NEVER tell the user to use an external app, website, or browser extension to do something your',
  '  own TOOLS can already do. You are the one doing it.',
  '- "I cannot do X" is only true AFTER you have looked through TOOLS and found nothing that fits.',
  '  Never conclude it from memory, and never about running something on a schedule or repeatedly',
  '  — "assess_flow" answers that, and the answer is usually yes.',
  '- If the GOAL needs an input you do not have and cannot get with a TOOL (e.g. a specific video URL),',
  '  do NOT give third-party instructions. Finish by telling the user, in the goal\'s language, exactly',
  '  what to provide so YOU can do it — naming the capability you would use (e.g. "give me the video URL',
  '  and I will fetch its transcript with my youtube tool and summarize it").',
  '- Answer purely from your own knowledge ONLY when the GOAL is genuinely informational and no TOOL applies.',
];

const APPROACH_LEAN: readonly string[] = [
  'HOW TO APPROACH THE GOAL:',
  '- You DO tasks with your TOOLS, not generic advice — if a TOOL can do it, USE it.',
  '- "I cannot do X" is only true after checking TOOLS and finding nothing — never from memory.',
  '- For anything needing web evidence, split the GOAL into 2-4 sub-questions and call "research"',
  '  on each (it reads and cites real pages in one step), then synthesize across the results.',
  '- If your observations are insufficient, say so honestly and tell the user, in the goal\'s language,',
  '  exactly what to provide so YOU can finish it with your own tools.',
];

/**
 * Every other block states a rule; this one states which rule wins. The prompt carries ~20 of
 * them with no precedence, and the pairs that collide are known from real runs: the repeat guard
 * against plan coverage, "ask if you are unsure" against "just try it", depth against the step
 * limit. Anthropic's published prompts do the same thing with an explicit `<default_stance>` —
 * a model that has to invent a tie-break invents a different one each turn.
 */
const PRECEDENCE: readonly string[] = [
  'WHEN TWO RULES COLLIDE:',
  '- Progress on the GOAL outranks bookkeeping: never re-run a call you already made because the',
  '  plan lists it, and never skip a step the GOAL needs because the plan omits it.',
  '- A rule that says NEVER outranks one that says prefer, and finishing outranks one more step',
  '  that cannot change your answer.',
];

/**
 * The counterweight to handing the model an `ask_user` action. A tool-using agent that can
 * ask questions will happily ask instead of working — "which sources should I use?" — so
 * the rule has to name the one situation that qualifies and refuse the rest by example.
 */
const ASK_RULES: readonly string[] = [
  '- "ask_user" pauses the whole run until the user replies, so it is a LAST RESORT, not a courtesy.',
  '  Use it ONLY when the GOAL cannot be attempted at all without something no TOOL can get: a URL or',
  '  file you were not given, or a choice only the user can make. NEVER ask to confirm a plan, to pick',
  '  between approaches you could just try, or because a tool MIGHT fail — call the tool and find out.',
  '  Ask ONE specific question, in the same language as the GOAL.',
];

/**
 * Asked for, never required. A model that ignores it simply behaves as it did before, which
 * is why the engine accepts a planless first action instead of spending a repair round-trip
 * on bookkeeping — but a model that answers gets a checklist that survives the scratch
 * window, so by turn 5 it still knows what it set out to cover.
 */
const PLAN_REQUEST: readonly string[] = [
  '- On this FIRST action, ALSO include "plan": [2-4 short sub-goals that together cover the GOAL].',
  '  Write it once — it is your checklist for the whole run, and it is what keeps you from',
  '  answering half the question after the earliest steps scroll out of view.',
];

const PLAN_PROGRESS: readonly string[] = [
  '- ALSO include "plan_done": [the 1-based indices of the plan items you have now finished].',
  '  Never rewrite "plan" — it is fixed for the run.',
];

const PLAN_DONE_NUDGE = [
  'Every item in your plan is checked off. Output the "finish" action now, unless an observation',
  'above revealed a gap the plan missed — in that case take the ONE step that closes it.',
].join('\n');

const STALL_WARNING: readonly string[] = [
  'WARNING: your last steps failed or were refused. Do NOT retry the same call or the same approach —',
  'switch tool, change the arguments substantially, or finish now with what you already have.',
];

function historySection(history: string): string[] {
  if (!history) return [];
  return [
    '',
    'EARLIER CONVERSATION IN THIS CHAT:',
    fenceUntrusted('conversation', history),
    'The GOAL below is the user\'s NEXT message in that conversation. It may be a',
    'follow-up, or their reply to a question you asked them. Resolve anything it refers',
    'to — a pronoun, "the second one", a bare "yes" — from the conversation above.',
  ];
}

export interface TurnPromptOptions {
  goal: string;
  catalog: string;
  scratch: ScratchEntry[];
  mustFinish: boolean;
  lean: boolean;
  mcpGrammar?: boolean;
  scratchSlots?: number;
  history?: string;
  /** Consecutive failed steps have piled up — tell the model to change course. */
  stalled?: boolean;
  /** `ask_user` is offered only while there is still budget to act on the reply. */
  allowAsk?: boolean;
  /** The run's checklist, carried into every prompt so progress outlives the scratch window. */
  plan?: AgentPlan;
}

function shapeCount(mcpGrammar: boolean, allowAsk: boolean): string {
  const count = 2 + (mcpGrammar ? 1 : 0) + (allowAsk ? 1 : 0);
  return `these ${count} shapes`;
}

export function buildTurnPrompt(opts: TurnPromptOptions): string {
  const {
    goal, catalog, scratch, mustFinish, lean,
    mcpGrammar = false, scratchSlots = SCRATCH_IN_PROMPT, history = '',
    stalled = false, allowAsk = false, plan = emptyPlan(),
  } = opts;
  const planned = plan.steps.length > 0;
  const finished = planComplete(plan);
  return [
    'You are Yobi\'s autonomous agent. You DO tasks yourself with the TOOLS listed below — you are',
    'NOT a chatbot that gives generic how-to advice. Read the GOAL, then ACT: pick the ONE tool that',
    'moves it forward, observe the result, repeat, and finish with a real answer in the SAME language',
    'as the GOAL.',
    '',
    ...renderEnvironment(),
    '',
    ...(lean ? APPROACH_LEAN : APPROACH_FULL),
    '',
    'OUTPUT RULES (critical):',
    '- Output ONLY one JSON object. No prose, no explanation, no markdown code fences.',
    `- Use exactly one of ${shapeCount(mcpGrammar, allowAsk)}:`,
    '  {"thought": string, "action": "call_tool", "tool": <a tool name>, "config": { ...string values... }}',
    ...(mcpGrammar
      ? ['  {"thought": string, "action": "call_mcp", "server": <a server handle from MCP TOOLS>, "name": <a tool name>, "arguments": { ...JSON... }}']
      : []),
    ...(allowAsk
      ? ['  {"thought": string, "action": "ask_user", "question": string}']
      : []),
    '  {"thought": string, "action": "finish", "title": string, "content": string}',
    '- A real "call_tool" action looks exactly like this — literal values, no placeholders:',
    '<example>',
    '{"thought":"I need current prices before I can compare them","action":"call_tool","tool":"research","config":{"query":"RTX 5080 current retail price"}}',
    '</example>',
    '- To finish, "title" is a short headline and "content" is the written answer in prose,',
    '  synthesized from the observations — its LENGTH matched to the question (a simple factual',
    '  one gets 1-2 sentences), and every web fact naming its source (page title or URL).',
    '  "content" must NOT be raw data, a list of links, or JSON.',
    '- Every value inside "config" MUST be a plain string. Provide every field marked REQUIRED.',
    ...(mcpGrammar
      ? [
          '- For an MCP tool (listed under MCP TOOLS), use "call_mcp": "arguments" is a JSON object matching that',
          '  tool — nested objects/arrays are allowed and must NOT be flattened to strings.',
          '- A tool marked "(write)" pauses for the user to approve it before it runs; a "(read)" tool runs at once.',
        ]
      : []),
    ...(allowAsk ? ASK_RULES : []),
    '- Use concrete literal values — NEVER {{placeholder}} notation.',
    '- Only call a tool listed under TOOLS or MCP TOOLS, using only its documented keys.',
    '- Never repeat an identical tool call, and do not add a step that cannot change your answer.',
    ...(mustFinish ? [] : planned ? PLAN_PROGRESS : PLAN_REQUEST),
    '',
    ...PRECEDENCE,
    '',
    'TOOLS:',
    catalog,
    ...historySection(history),
    '',
    'GOAL:',
    /*
     * Still NOT fenced, on purpose — see test/promptFencing.test.ts. A fence marks a span the
     * model must not take direction from, and the goal is the one span it must. A bot-triggered
     * run does put third-party text here, but that is answered by giving a bot origin fewer
     * powers (MCP writes auto-denied, flow writes refused), not by demoting the instruction.
     */
    goal.trim(),
    '',
    ...(planned ? [...renderPlan(plan), ''] : []),
    renderScratch(scratch, scratchSlots),
    '',
    ...(stalled && !mustFinish && !finished ? [...STALL_WARNING, ''] : []),
    mustFinish
      ? 'You have reached the step limit. You MUST now output a "finish" action whose "content" is your best written answer, synthesized from the observations above.'
      : finished
        ? PLAN_DONE_NUDGE
        : 'Decide the next single action and output its JSON now.',
  ].join('\n');
}

export function buildDeltaPrompt(
  entry: ScratchEntry,
  index: number,
  mustFinish: boolean,
  stalled = false,
  plan: AgentPlan = emptyPlan(),
): string {
  const finished = planComplete(plan);
  return [
    `Observation from step ${index} — ${entry.tool}:`,
    entry.deltaObservation || entry.observation || '(empty)',
    '',
    // On a live provider thread this is the ONLY message sent, so the checklist has to ride
    // along or the plan would exist for BYOK runs and be invisible for browser ones.
    ...(plan.steps.length > 0 && !mustFinish ? [...renderPlan(plan), ''] : []),
    ...(stalled && !mustFinish && !finished ? [...STALL_WARNING, ''] : []),
    mustFinish
      ? 'You have reached the step limit. Output ONLY the "finish" JSON object now, whose "content" is your best written answer synthesized from every observation above.'
      : finished
        ? PLAN_DONE_NUDGE
        : 'Decide the next single action. Output ONLY one JSON object, in one of the shapes defined earlier — no prose, no markdown code fences.',
  ].join('\n');
}

/**
 * The synthesis window, for BYOK only. Every other prompt is capped by the provider's input
 * limit, but the final answer is the one place where dropping an early observation loses
 * evidence the run already paid for — and once the turn ceiling can grow past the 6-slot
 * window, that is exactly what a shared window would do.
 */
export const SYNTH_SCRATCH_SLOTS_LEAN = 16;
export const SYNTH_SCRATCH_BUDGET_LEAN = 64_000;

export interface FinishPromptOptions {
  goal: string;
  scratch: ScratchEntry[];
  lean: boolean;
  scratchSlots?: number;
  totalBudget?: number;
  history?: string;
  plan?: AgentPlan;
}

export function buildFinishPrompt(opts: FinishPromptOptions): string {
  const {
    goal, scratch, lean,
    scratchSlots = SCRATCH_IN_PROMPT, totalBudget = SCRATCH_TOTAL_BUDGET,
    history = '', plan = emptyPlan(),
  } = opts;
  const insufficiency = lean
    ? [
        '- Base the answer ONLY on the observations; do not invent facts. If the observations are',
        '  insufficient, say so honestly and tell the user what to provide so YOU can finish it with your own tools.',
      ]
    : [
        '- Base the answer ONLY on the observations; do not invent facts. If the observations are',
        '  insufficient, say so honestly and tell the user what to provide so YOU can finish it with your',
        '  own tools — never recommend external apps, websites, or extensions to do what your tools already do.',
      ];
  return [
    'You are Yobi\'s agent. Below are the user\'s GOAL and the OBSERVATIONS you gathered from tools.',
    'Write the FINAL answer for the user, in the SAME language as the GOAL.',
    '',
    envContextLine(),
    '',
    'OUTPUT RULES (critical):',
    '- Output ONLY one JSON object, nothing else, no markdown code fences:',
    '  {"title": string, "content": string}',
    '- "title": a short headline for the answer, in the goal\'s language.',
    '- "content": the written answer — analysis / recommendation / summary — in prose,',
    '  SYNTHESIZED from the observations. It must NOT be raw data, a JSON array/object, or a bare list of links.',
    '- Match the answer\'s LENGTH to the question asked: a simple factual one gets 1-2 sentences,',
    '  a research question gets the full write-up. Padding a short answer out is not thoroughness.',
    '- Name the source (page title or URL) next to any fact that came from the web, so the user can check it.',
    ...insufficiency,
    ...(plan.steps.length > 0
      ? ['- Cover every item of the plan below that the observations support, and say which ones they do not.']
      : []),
    ...historySection(history),
    '',
    'GOAL:',
    goal.trim(),
    '',
    ...(plan.steps.length > 0 ? [...renderPlan(plan), ''] : []),
    renderScratch(scratch, scratchSlots, totalBudget),
  ].join('\n');
}

export function historyThatFits(build: (history: string) => string, history: string, providerUrl: string): string {
  if (!history || isByokTargetUrl(providerUrl)) return history;
  return preparePromptForProvider(build(history), providerUrl).truncated ? '' : history;
}

export function buildRepairPrompt(prevRaw: string, error: string, corrected: string): string {
  return [
    'Your previous response was REJECTED.',
    `Reason: ${error}`,
    '',
    'Your previous output (do not repeat its mistake):',
    prevRaw.trim().slice(0, 1_500),
    '',
    'Produce a corrected response that obeys ALL rules below:',
    '',
    corrected,
  ].join('\n');
}

export function buildActionRepair(opts: TurnPromptOptions, providerUrl: string) {
  return (prevRaw: string, error: string): string => {
    const build = (h: string): string =>
      buildRepairPrompt(prevRaw, error, buildTurnPrompt({ ...opts, history: h }));
    return build(historyThatFits(build, opts.history ?? '', providerUrl));
  };
}
