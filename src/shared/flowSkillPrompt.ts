import type { SkillSpec, SkillType } from './flowSkillSpecs';
import { SKILL_OUTPUT, SKILL_SPECS, SKILLS_WITHOUT_OUTPUT_KEY } from './flowSkillSpecs';
import { SKILL_NOTES } from './flowSkillNotes';

/*
 * Flow generation is a two-stage, three-tier disclosure, modelled on the SKILL.md contract:
 *
 *   tier 1  `brief`            every skill, one line — stage A, all that selection ever sees
 *   tier 2  `renderSkillLine`  selected skills only  — stage B, the config + OUTPUT contract
 *   tier 3  `SKILL_NOTES`      selected skills only  — stage B, the non-obvious failure modes
 *
 * Rendering all 46 skills at tier 2 in one shot is what silently broke this feature: the prompt
 * reached 43.7k chars against Gemini's 33,499 cap, so `preparePromptForProvider` reported a
 * truncation and the generator refused to send anything at all. Narrowing tier 2/3 to the
 * selection is the fix, and `buildFlowGenerationPrompt` therefore REQUIRES a skill list — there
 * is deliberately no way to ask it for "all of them" again.
 */

/**
 * Control flow is never left to the selection. Models routinely pick `loop` and forget
 * `end_loop`, and a flow missing its closer fails validation after both stages have been paid
 * for. All eight together cost ~600 chars at tier 2, which is cheaper than one repair round.
 */
export const ALWAYS_INCLUDED_SKILLS: readonly SkillType[] = [
  'loop', 'end_loop', 'if', 'end_if', 'stop', 'break', 'continue', 'comment',
];

/**
 * How many working skills stage B will disclose. Not a taste judgement — it is the number the
 * budget allows: with the eight fattest skills selected, the REPAIR prompt (generation prompt
 * plus the rejected output) reaches 93% of Gemini's cap, and at ten it goes over. Real flows
 * use three to six. Extras beyond this are dropped in requested order, so the model's own
 * priority decides what survives. Pinned by test/flowGenPromptBudget.test.ts.
 */
export const MAX_SELECTED_SKILLS = 8;

export function renderSkillBrief(spec: SkillSpec): string {
  return `- "${spec.type}": ${spec.brief}`;
}

/** Tier 1 — every skill, one line each. The whole of what stage A sees. */
export function buildSkillIndex(): string {
  return SKILL_SPECS.map(renderSkillBrief).join('\n');
}

export function renderSkillLine(spec: SkillSpec): string {
  const hasOutput = !SKILLS_WITHOUT_OUTPUT_KEY.includes(spec.type);
  const fields = spec.fields.length === 0
    ? 'config: {} (empty object)'
    : `config keys: ${spec.fields.map((f) => `"${f.key}" (${f.desc}${f.required ? '; REQUIRED' : ''})`).join('; ')}`;
  const outputDoc = SKILL_OUTPUT[spec.type];
  const output = outputDoc ? ` OUTPUT: ${outputDoc}` : '';
  return `- "${spec.type}"${hasOutput ? '' : ' [no outputKey]'}: ${spec.summary} ${fields}${output}`;
}

const KNOWN_SKILLS = new Set<string>(SKILL_SPECS.map((spec) => spec.type));
const CONTROL_SET = new Set<string>(ALWAYS_INCLUDED_SKILLS);

/**
 * Normalizes a requested selection into the skills stage B will disclose: unknown names are
 * dropped rather than rejected (a selection is bookkeeping, and losing a whole assessment over
 * one hallucinated name costs more than ignoring it), the working skills are capped at
 * `MAX_SELECTED_SKILLS` in requested order, control flow is appended for free, and the result
 * is emitted in `SKILL_SPECS` order so the same selection always renders identically.
 */
export function resolveSelectedSkills(requested: readonly string[]): SkillType[] {
  const working: string[] = [];
  for (const name of requested) {
    if (!KNOWN_SKILLS.has(name) || CONTROL_SET.has(name) || working.includes(name)) continue;
    working.push(name);
    if (working.length >= MAX_SELECTED_SKILLS) break;
  }
  const wanted = new Set<string>([...working, ...ALWAYS_INCLUDED_SKILLS]);
  return SKILL_SPECS.filter((spec) => wanted.has(spec.type)).map((spec) => spec.type);
}

function renderNotes(skills: readonly SkillType[]): string[] {
  const notes = skills
    .map((type) => ({ type, note: SKILL_NOTES[type] }))
    .filter((entry): entry is { type: SkillType; note: string } => Boolean(entry.note))
    .map((entry) => `- "${entry.type}": ${entry.note}`);
  if (notes.length === 0) return [];
  return [
    '',
    'NOTES ON THE SKILLS ABOVE (mistakes that produce a flow which validates but does not work):',
    ...notes,
  ];
}

/**
 * What can START a flow. This belongs at tier 1 next to the skills, because "what a flow can do"
 * and "what makes a flow run" are two independent capability axes and the assessment is asked
 * about both. Leaving it to stage B produced a confident, wrong refusal: asked for "push the
 * time to Telegram every minute", the assessor saw 46 skill briefs with no mention of
 * scheduling and reported that Yobi has no cron — a capability it has had all along.
 */
export const TRIGGER_BRIEFS: readonly string[] = [
  '- "cron": run on a SCHEDULE — any repeating time, from every few seconds to specific days and times (e.g. every minute, every weekday at 08:00). Runs in the background while the app is open; no external scheduler needed.',
  '- "hotkey": run when the user presses a global keyboard shortcut, from anywhere on the desktop.',
  '- "bot": run when the user sends a /command to the Telegram or LINE bot; their message text becomes an input variable.',
  '- "chat": run when the user types a /command in the app\'s own chat box; the text after it becomes an input variable.',
  '- "manual": run only when the user presses Run. The default when the request implies no timing.',
];

const ASSESS_EXAMPLE = JSON.stringify(
  {
    skills: ['rss', 'browser', 'llm', 'bot'],
    trigger: 'cron',
    outline: [
      'Every weekday at 08:00, fetch new articles from the feed',
      'Read each article and summarize it',
      'Send each summary to Telegram',
    ],
    gaps: [],
    verdict: 'full',
  },
  null,
  2,
);

export function buildFlowAssessPrompt(goal: string): string {
  return [
    // Never names the framework Yobi is built on. Everything below this line is sent verbatim
    // to a third-party model, and what the app is made of is not something a user asking for a
    // flow has agreed to disclose. The prompts describe capabilities, not the implementation.
    'You are a capability assessor for "Yobi", a desktop automation app.',
    'A Yobi flow is a TRIGGER plus a list of steps, each step running one SKILL. Below is every',
    'trigger and every skill Yobi has. Decide what the user request needs, and whether Yobi',
    'covers it at all.',
    '',
    'OUTPUT RULES (critical):',
    '- Output ONLY the JSON object. No prose, no explanation, no markdown code fences.',
    '- Shape:',
    '{',
    '  "skills": [ ...skill names, spelled exactly as below... ],',
    '  "trigger": "cron" | "hotkey" | "bot" | "chat" | "manual",',
    '  "outline": [ ...3-8 short steps describing what the flow will do, in order... ],',
    '  "gaps": [ ...parts of the request no trigger or skill can do; [] when there are none... ],',
    '  "verdict": "full" | "partial" | "none"',
    '}',
    '- "skills": ONLY names from the list below — never invent one. Include every skill the flow',
    '  needs in order to fetch, transform and deliver its result. You may omit loop / if / stop and',
    '  the other control-flow skills; they are always available and are added for you.',
    '- "trigger": pick the one that matches how the request says the flow should START. Anything',
    '  about timing or repetition ("every minute", "each morning", "hourly") is "cron" — Yobi runs',
    '  those itself. Never report scheduling, repetition or background running as a gap.',
    '- "outline" describes the FLOW, not your reasoning: one line per meaningful step. When the',
    '  trigger is "cron", say the schedule in the first line so the user can check it.',
    '- "verdict": "full" when Yobi covers the whole request, "partial" when a flow can be built',
    '  but part of the request is left out, "none" when no useful flow can be built at all.',
    '- Judge ONLY against the triggers and skills below. Never refuse on a belief about what the',
    '  app cannot do that is not stated here.',
    '- Write "outline" and "gaps" in the SAME language as the user request.',
    '',
    'TRIGGERS — how a flow starts:',
    ...TRIGGER_BRIEFS,
    '',
    'SKILLS — what a flow does:',
    buildSkillIndex(),
    '',
    'EXAMPLE (request: "every morning summarize my RSS feed and send it to Telegram"):',
    ASSESS_EXAMPLE,
    '',
    'USER REQUEST:',
    goal.trim(),
  ].join('\n');
}

const EXAMPLE_FLOW_JSON = JSON.stringify(
  {
    name: 'RSS Digest to Telegram',
    description: 'Summarize each new RSS article and send it to Telegram on weekday mornings.',
    trigger: { type: 'cron', cronExpression: '0 8 * * 1-5' },
    steps: [
      { type: 'rss', label: 'Fetch feed', config: { url: 'https://www.engadget.com/rss.xml' }, outputKey: 'rss_1' },
      { type: 'stop', label: 'Stop if nothing new', config: { value: '{{rss_1}}' }, outputKey: '' },
      { type: 'loop', label: 'For each new article', config: { input: '{{rss_1}}', loopVar: 'item', limitIterations: 'true', maxIterations: '5' }, outputKey: 'loop_1' },
      { type: 'browser', label: 'Fetch article', config: { url: '{{item.link}}', includeImage: 'true', emitFailFlag: 'true' }, outputKey: 'browser_1' },
      { type: 'if', label: 'Skip if empty', config: { left: '{{browser_1}}', operator: 'is_empty', right: '' }, outputKey: '' },
      { type: 'continue', label: 'Next article', config: {}, outputKey: '' },
      { type: 'end_if', label: 'End If', config: {}, outputKey: '' },
      { type: 'llm', label: 'Summarize', config: { prompt: 'Summarize this article as a short briefing.\n\nTitle: {{item.title}}\nLink: {{item.link}}\n\n{{browser_1}}', provider: '', emitFailFlag: 'true' }, outputKey: 'llm_1' },
      { type: 'if', label: 'Skip if the LLM failed', config: { left: '{{llm_1.isFailed}}', operator: 'equals', right: '1' }, outputKey: '' },
      { type: 'continue', label: 'Next article', config: {}, outputKey: '' },
      { type: 'end_if', label: 'End If', config: {}, outputKey: '' },
      { type: 'bot', label: 'Send to Telegram', config: { message: '{{llm_1}}', chatId: '', attachment: '{{browser_1.image}}' }, outputKey: 'bot_1' },
      { type: 'end_loop', label: 'End Loop', config: {}, outputKey: '' },
    ],
  },
  null,
  2,
);

export function buildFlowGenerationPrompt(
  description: string,
  skills: readonly string[],
  triggerHint?: string,
): string {
  const selected = resolveSelectedSkills(skills);
  const selectedSet = new Set<SkillType>(selected);
  const skillLines = SKILL_SPECS.filter((spec) => selectedSet.has(spec.type)).map(renderSkillLine).join('\n');
  return [
    'You are a flow compiler for "Yobi", a desktop automation app.',
    'Convert the user request below into ONE Yobi flow expressed as strict JSON.',
    '',
    'OUTPUT RULES (critical):',
    '- Output ONLY the JSON object. No prose, no explanation, no markdown code fences.',
    '- Do NOT include "id", "createdAt", or "updatedAt" — they are assigned by the app.',
    '- Every value inside every step "config" object MUST be a string (use "true"/"false", not booleans).',
    '',
    'JSON SHAPE:',
    '{',
    '  "name": string,                // short flow name',
    '  "description": string,         // one sentence',
    '  "trigger": { "type": "manual" | "hotkey" | "cron" | "bot" | "chat", ... },',
    '  "extraTriggers": [ { ...same shape as trigger... } ],  // OPTIONAL — omit unless the flow needs several triggers',
    '  "steps": [ { "type": <skill>, "label": string, "config": { ... }, "outputKey": string }, ... ]',
    '}',
    '',
    'TRIGGER:',
    '- manual: {"type":"manual"} (default when unsure)',
    '- hotkey: {"type":"hotkey","keys":"CommandOrControl+Shift+Y"}  (a keyboard accelerator: "+"-joined modifiers CommandOrControl/Alt/Shift/Super plus ONE key, or a bare media/volume/function key like "MediaPlayPause"; pick an uncommon combo to avoid collisions)',
    '- cron:   {"type":"cron","cronExpression":"0 8 * * 1-5"}  (standard 5-field cron: minute hour day-of-month month day-of-week; a 6th LEADING seconds field is allowed for sub-minute schedules; prefer "*" for day-of-month and month — other shapes still run but the visual schedule editor cannot display them)',
    '- bot:    {"type":"bot","botCommand":"my_cmd","botCommandDescription":"...","botInputVariable":"input"}  (a Telegram /command)',
    '- chat:   {"type":"chat","chatCommand":"my_cmd","chatCommandDescription":"...","chatInputVariable":"input"}  (a /command run from the in-app chat)',
    'Infer the trigger from the request (e.g. "every morning at 8" -> cron "0 8 * * *").',
    // Threaded from stage A so the two stages cannot disagree about how the flow starts — the
    // assessment is what the user was shown and approved, so it is the one that binds.
    ...(triggerHint
      ? [`- The assessment already chose "${triggerHint}" for this request; use it unless the request plainly contradicts it.`]
      : []),
    '- botCommand/chatCommand grammar: start with a lowercase letter, then only a-z 0-9 _, max 32 chars, no leading "/" (e.g. "daily_digest").',
    '- A bot/chat trigger seeds the user\'s argument text as the variable named by botInputVariable/chatInputVariable (default {{input}}); a bot trigger also exposes {{bot.triggerChatId}} (the sender\'s chat id, e.g. for a bot step\'s chatId) and {{bot.triggerUserId}}.',
    '- hotkey/cron/manual triggers seed NO input variable — such a flow must start from a data-producing step (rss, browser, clipboard, …), never from {{input}}.',
    '- Multiple triggers: keep the primary in "trigger" and put the rest in the OPTIONAL "extraTriggers" array (same shape) — e.g. a cron PLUS a chat command. Omit "extraTriggers" entirely for a single-trigger flow.',
    '',
    'STEPS — these skills were selected for this request; use ONLY these:',
    skillLines,
    ...renderNotes(selected),
    '',
    'RULES:',
    '- "outputKey" is a unique snake_case id (e.g. "rss_1", "llm_1"); reference a prior step output with {{outputKey}}.',
    '- A {{outputKey}} reference must point to a step that appears EARLIER in the steps array.',
    '- Each step\'s OUTPUT (above) states exactly what {{outputKey}} resolves to — match a downstream reference to that shape (a JSON array → loop it; a plain string → use it directly).',
    '- Built-in variables: {{clipboard}} (clipboard text snapshotted at flow start), {{timestamp}} (ISO-8601 UTC time at flow start), {{flow.name}}. Loop body: {{item}}, {{item.<field>}} (or the custom loopVar name).',
    '- Sub-variables: some steps also expose {{outputKey.field}} extras (see each skill\'s OUTPUT, e.g. {{yt_1.title}}, {{weather_1.temp}}, {{stock_1.price}}); only reference the sub-variables named in that skill\'s OUTPUT. Exception: every field of an object LOOP item is available as {{<loopVar>.<field>}}.',
    '- Any other {{variable}} is INVALID: an unknown or misspelled reference silently resolves to "" at runtime, and the app rejects flows that contain one — use only variables defined above or produced by an EARLIER step.',
    '- Magic {{file}}: capture, file_write, file_download, and an llm step with exportFormat set the most-recently produced file path as {{file}}; to send or delete that file, reference {{file}} (NOT the step\'s outputKey).',
    '- Failure branching: a step with emitFailFlag="true" (llm, browser, browser_js, bot, research) sets {{outputKey.isFailed}}="0" on success or "1" on failure and continues instead of aborting — gate later steps with an "if" on {{outputKey.isFailed}}.',
    '- Skills marked [no outputKey] must use "outputKey": "".',
    '- Every "loop" needs a matching "end_loop" later; every "if" needs a matching "end_if" (blocks may nest).',
    '- Every config value is a PLAIN string. Never use markdown: URLs must be bare like "https://example.com/feed", NOT "[https://example.com/feed](https://example.com/feed)".',
    '- Write "name", "description", every step "label", and user-facing text (llm prompts, notify/bot/email messages) in the SAME language as the user request below.',
    '- Keep the flow minimal and correct; only include steps the request needs.',
    '',
    'EXAMPLE — it shows the SHAPE of a flow and may name skills that are not in your list above;',
    'copy its structure, not its steps (request: "every weekday at 8am summarize my RSS feed and send it to Telegram"):',
    EXAMPLE_FLOW_JSON,
    '',
    'USER REQUEST:',
    description.trim(),
  ].join('\n');
}

export function buildFlowRepairPrompt(
  description: string,
  skills: readonly string[],
  previousResponse: string,
  error: string,
  triggerHint?: string,
): string {
  return [
    'Your previous attempt to produce a Yobi flow JSON was REJECTED.',
    `Validation error: ${error}`,
    '',
    'Your previous output (for reference — do not repeat its mistake):',
    // 2,000, not 4,000: the repair prompt is the widest one this module builds — it carries the
    // whole generation prompt on top of this excerpt — and it is what sets the real ceiling on
    // MAX_SELECTED_SKILLS. The error message above is what the model has to act on; the excerpt
    // only has to be enough to recognize its own output.
    previousResponse.trim().slice(0, 2_000),
    '',
    'Produce a corrected flow that fixes the error above and obeys ALL of these rules:',
    '',
    buildFlowGenerationPrompt(description, skills, triggerHint),
  ].join('\n');
}
