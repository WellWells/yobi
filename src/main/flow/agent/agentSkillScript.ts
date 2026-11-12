import { isSandboxScript, runSandboxedScript } from '../../agentSkills/skillSandbox';

/*
 * A skill's JavaScript run by `use_skill` "run": in the sandbox (no network, no file writes, no other
 * programs, only the skill's own files, no environment), so it needs no confirmation — a calculator,
 * not a command. A check digit left to the model comes out wrong on weaker models, and a bot
 * account without `shell` has no other way to run the script. Every other script still
 * goes through `shell`, which the user confirms.
 */

const ARGS_MAX = 64;
const ARG_MAX_CHARS = 4_000;
const STDIN_MAX_CHARS = 60_000;
const STDOUT_SHOWN = 12_000;
const STDERR_SHOWN = 2_000;

/** The arguments as the model wrote them: a command line (quotes group words) or a JSON array. */
export function parseScriptArgs(raw: string | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.slice(0, ARGS_MAX).map((arg) => String(arg).slice(0, ARG_MAX_CHARS));
    } catch {
      // Not JSON after all: read as a command line.
    }
  }
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && (text[i + 1] === '"' || text[i + 1] === '\\')) current += text[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args.slice(0, ARGS_MAX).map((arg) => arg.slice(0, ARG_MAX_CHARS));
}

/** "run" as the model wrote it: a path, or a whole `node scripts/x.mjs --flag` line. */
export function splitRunLine(raw: string): { script: string; args: string[] } {
  const words = parseScriptArgs(raw);
  const start = words[0] && /^node(\.exe)?$/i.test(words[0]) ? 1 : 0;
  return { script: words[start] ?? '', args: words.slice(start + 1) };
}

function shown(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[cut at ${max} characters]` : text;
}

export interface SkillScriptOutcome {
  observation: string;
  status: 'ok' | 'error';
}

/** A sandbox refusal reads as an error the script printed: it needed what the sandbox does not give. */
const NEEDS_MORE = /ERR_ACCESS_DENIED|not available in the skill sandbox|fetch is not defined|WebSocket is not defined/;

export async function runSkillScript(input: {
  skill: string;
  dir: string;
  script: string;
  args: string[];
  stdin?: string;
  shell: boolean;
  signal?: AbortSignal;
}): Promise<SkillScriptOutcome> {
  const { skill, script } = input;
  if (!isSandboxScript(script)) {
    return {
      observation: input.shell
        ? `ERROR: "${script}" is not JavaScript, so it cannot run here. Run it with "shell" and "skill": "${skill}" (the user confirms each command).`
        : `ERROR: "${script}" is not JavaScript, and this run cannot run other programs. Do that step another way, or tell the user it needs a run on their computer.`,
      status: 'error',
    };
  }
  const result = await runSandboxedScript({
    skillDir: input.dir,
    script,
    args: input.args,
    ...(input.stdin ? { stdin: input.stdin.slice(0, STDIN_MAX_CHARS) } : {}),
    signal: input.signal,
  });
  if (result.refused) return { observation: `ERROR: "${script}" is not a script of the skill "${skill}".`, status: 'error' };
  if (result.timedOut) return { observation: `ERROR: "${script}" ran past its time limit and was stopped. Check the arguments against the skill's instructions.`, status: 'error' };
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const blocked = NEEDS_MORE.test(stderr);
  const lines = [
    `SCRIPT ${script} OF SKILL "${skill}" (exit code ${result.exitCode ?? 'none'}):`,
    stdout ? shown(stdout, STDOUT_SHOWN) : '(it printed nothing)',
    ...(stderr ? ['STDERR:', shown(stderr, STDERR_SHOWN)] : []),
    ...(result.truncated ? ['[the output was longer and was cut]'] : []),
  ];
  if (blocked) {
    lines.push(input.shell
      ? `It needs something this sandbox does not allow (the network, writing files, other programs, files outside the skill). Run it with "shell" and "skill": "${skill}" instead (the user confirms).`
      : 'It needs something this sandbox does not allow (the network, writing files, other programs, files outside the skill), and this run cannot run commands.');
    return { observation: lines.join('\n'), status: 'error' };
  }
  lines.push('Use what it printed exactly as printed: never compute or change those values yourself.');
  return { observation: lines.join('\n'), status: 'ok' };
}
