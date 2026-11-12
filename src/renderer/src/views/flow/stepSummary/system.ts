import { resolveSysInfoSelection } from '../../../../../shared/sysinfoFields';
import { cut, flagged, isNamed, lines, list, middle, num, ok, outputToken, parts, t, unset, value, wholeRef } from './core';
import type { StepSummaryContext, Summarizer } from './types';

function shellName(ctx: StepSummaryContext, raw: string): string {
  if (!raw) return t(ctx, 'flow.summary.shell.default');
  if (raw === 'powershell') return 'PowerShell';
  return raw.split(/[\\/]/).at(-1) ?? raw;
}

const shell: Summarizer = (step, ctx) => {
  const command = step.config.command ?? '';
  const how = parts(shellName(ctx, value(step, 'shell')), outputToken(step));
  if (!command.trim()) return unset(ctx, 'shell', ['command'], how);
  const commandLines = lines(command);
  const first = cut(commandLines[0], 60) + (commandLines.length > 1 ? ' …' : '');
  if (isNamed(step, ctx.t)) return ok(step.label.trim(), first, { secondaryCode: true });
  return ok(first, how, { code: true });
};

/** "notepad.exe {{file}}" with its folder below: the folder cut off the end is the part that differs least. */
const run: Summarizer = (step, ctx) => {
  const file = value(step, 'path');
  if (!file) return unset(ctx, 'run', ['path']);
  const args = value(step, 'args');
  const slash = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'));
  const variable = Boolean(wholeRef(file));
  const name = variable || slash < 0 ? file : file.slice(slash + 1);
  const folder = variable || slash < 0 ? undefined : middle(file.slice(0, slash), 40);
  const program = args ? `${name} ${cut(args, 32)}` : name;
  if (isNamed(step, ctx.t)) return ok(step.label.trim(), program, { secondaryCode: true });
  return ok(program, folder, { code: true });
};

const sysinfo: Summarizer = (step, ctx) => {
  const selected = resolveSysInfoSelection(step.config);
  const output = outputToken(step);
  if (step.config.fields !== undefined && selected.length === 0) return unset(ctx, 'sysinfo', ['fields'], output);
  const names = selected.map((key) => t(ctx, `flow.skill.sysinfo.field.${key}`));
  const what = step.config.fields === undefined
    ? t(ctx, 'flow.summary.sysinfo.basic', { count: names.length })
    : names.length > 3 ? t(ctx, 'flow.summary.more.fields', { items: list(ctx, names.slice(0, 3)), count: names.length, more: names.length - 3 }) : list(ctx, names);
  const detail = parts(
    selected.includes('publicIp') ? t(ctx, 'flow.summary.sysinfo.online') : undefined,
    step.config.format === 'json' ? 'JSON' : undefined,
    output,
  );
  return isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, detail)) : ok(what, detail);
};

const capture: Summarizer = (step, ctx) => {
  const format = (value(step, 'format') || 'png').toUpperCase();
  const what = t(ctx, 'flow.summary.capture.screen', { format });
  const folder = value(step, 'output');
  const where = folder
    ? t(ctx, 'flow.summary.capture.to', { folder: middle(folder, 32), file: '{{file}}' })
    : t(ctx, 'flow.summary.capture.toDefault', { file: '{{file}}' });
  return isNamed(step, ctx.t) ? ok(step.label.trim(), parts(what, where)) : ok(what, where);
};

const POWER_ACTIONS = new Set(['shutdown', 'restart', 'logout', 'sleep', 'lock', 'hibernate']);
const FORCES_CLOSE = new Set(['shutdown', 'restart', 'logout']);

/** Steps after this one that would do something (notes do not run). */
function stepsAfter(ctx: StepSummaryContext): number {
  return ctx.steps.slice(ctx.index + 1).filter((step) => step.type !== 'comment').length;
}

const power: Summarizer = (step, ctx) => {
  const action = value(step, 'action');
  if (!POWER_ACTIONS.has(action)) return { primary: t(ctx, 'flow.summary.power.none'), state: 'unset' };
  const what = t(ctx, `flow.skill.power.action.${action}`);
  const after = stepsAfter(ctx);
  const summary = ok(isNamed(step, ctx.t) ? step.label.trim() : what, parts(
    isNamed(step, ctx.t) ? what : undefined,
    FORCES_CLOSE.has(action) ? t(ctx, 'flow.summary.power.forceClose') : undefined,
  ));
  return after > 0 ? flagged(summary, 'warning', t(ctx, 'flow.summary.power.after', { count: after })) : summary;
};

const restartApp: Summarizer = (_step, ctx) => {
  const summary = ok(t(ctx, 'flow.skill.restart_app'));
  const after = stepsAfter(ctx);
  return after > 0 ? flagged(summary, 'warning', t(ctx, 'flow.summary.restart.after', { count: after })) : summary;
};

const MAX_DELAY_MS = 3_600_000;

/** A wait in the largest unit that reads cleanly: 250 毫秒, 1.5 秒, 5 分鐘. */
export function delayText(ctx: StepSummaryContext, ms: number): string {
  if (ms >= 60_000 && ms % 6_000 === 0) return t(ctx, 'flow.summary.delay.minutes', { count: num(ctx, ms / 60_000, 1) });
  if (ms >= 1_000 && ms % 100 === 0) return t(ctx, 'flow.summary.delay.seconds', { count: num(ctx, ms / 1_000, 1) });
  return t(ctx, 'flow.summary.delay.ms', { count: num(ctx, ms) });
}

const delay: Summarizer = (step, ctx) => {
  const raw = value(step, 'delayMs');
  const ms = raw === '' ? 1_000 : Number(raw);
  const named = isNamed(step, ctx.t);
  const shape = (what: string) => (named ? ok(step.label.trim(), what) : ok(what));
  if (wholeRef(raw)) return shape(t(ctx, 'flow.summary.delay.wait', { time: raw }));
  if (!Number.isFinite(ms) || ms < 0) return flagged(shape(t(ctx, 'flow.summary.delay.wait', { time: raw })), 'error', t(ctx, 'flow.summary.delay.notNumber'));
  if (ms > MAX_DELAY_MS) return shape(t(ctx, 'flow.summary.delay.capped', { time: delayText(ctx, MAX_DELAY_MS) }));
  return shape(t(ctx, 'flow.summary.delay.wait', { time: delayText(ctx, ms) }));
};

/** A note is a signpost: its first line is the section's heading, the rest its second line. */
const comment: Summarizer = (step, ctx) => {
  const noteLines = lines(step.config.note ?? '');
  if (noteLines.length === 0) return { primary: t(ctx, 'flow.summary.comment.empty'), state: 'unset' };
  return ok(cut(noteLines[0], 60), noteLines.length > 1 ? cut(noteLines.slice(1).join(' '), 80) : undefined);
};

export const SYSTEM_SUMMARIES = {
  shell, run, sysinfo, capture, power, restart_app: restartApp, delay, comment,
} as const;
