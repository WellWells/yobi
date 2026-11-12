import React from 'react';
import { Code, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { Braces } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { FLOW_VAR_PREFIX } from '../../../../shared/flowVariables';
import { resolveSysInfoSelection } from '../../../../shared/sysinfoFields';
import { isCaptureFormat, isFileOutputStep, parseLlmExportFormats } from '../../../../shared/fileOutputStep';
import { isShareLinkFormat } from '../../../../shared/shareFormat';
import { FAIL_SOFT_SKILLS } from '../../../../shared/flowFailSoft';
import { browserPages, parseBrowserUrlRows } from './skills/browserUrlRows';
import { splitSymbols } from '../../../../shared/flowListTerms';
import { almanacFiltered, almanacOneDay } from '../../../../shared/almanacSpan';
import type { FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { insertIntoField } from '../../components/textContextMenu/textMenuTarget';

export interface LoopVarHint {
  name: string;
  sourceType?: SkillType;
}

export function loopSubfields(sourceType?: SkillType): string[] {
  switch (sourceType) {
    case 'youtube_subs': return ['title', 'link', 'image'];
    case 'x_posts': return ['title', 'link', 'author', 'name', 'date', 'text', 'image', 'replies', 'likes'];
    case 'ptt_board': return ['title', 'link', 'board', 'author', 'score', 'date'];
    case 'x_trends': return ['title', 'link', 'context', 'volume', 'rank', 'posts'];
    // Only {{thread.replies}} is a list; the step's own output is text.
    case 'x_thread': return ['author', 'name', 'date', 'text', 'link', 'likes'];
    case 'search': return ['title', 'link', 'snippet'];
    case 'gmap_reviews': return ['author', 'rating', 'date', 'text', 'reply'];
    case 'calendar': return ['title', 'start', 'end', 'allDay', 'location', 'link', 'calendar'];
    // .account is set only when several mailboxes are read together.
    case 'mail_fetch': return ['from', 'subject', 'date', 'body', 'attachments', 'id', 'account'];
    case 'rss':
    case 'scraper':
    case 'research':
    case 'file_list': return ['title', 'link'];
    // A script returns whatever shape it builds: no fields to promise.
    case 'js':
    case 'random':
    case 'on_change': return [];
    default: return ['title', 'link'];
  }
}

/** Inserts at the field's caret (over its selection) as typing would, so Ctrl+Z takes it back. */
export function insertTokenAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement,
  token: string,
): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  insertIntoField(el, start, end, token);
}

/** The history sub-vars a stock or forex step adds once it has a period or a date. */
function historyFields(config: Record<string, string>): string[] {
  const date = (config.date ?? '').trim();
  if (!(config.period ?? '').trim() && !date) return [];
  return ['periodChangePct', 'endClose', ...(date ? ['dateClose'] : [])];
}

/** A dated forecast has no current conditions: its sub-vars describe the first day. */
function weatherFields(config: Record<string, string>): string[] {
  const dated = (config.date ?? '').trim() || (config.hours ?? '').trim();
  return dated
    ? ['high', 'low', 'rainChance', 'condition', 'precipitation', 'isFailed']
    : ['temp', 'condition', 'high', 'low', 'isFailed'];
}

/** What an on_change step adds only with "Include what changed" on. */
export const ON_CHANGE_DIFF_FIELDS = ['diff', 'added', 'removed', 'isFirstRun', 'hasDiff', 'truncated', 'previous', 'previousAt', 'checkedAt'] as const;

/** One day has the whole card; several days or a filter only the list's own fields. */
function almanacFields(config: Record<string, string>): string[] {
  if (almanacFiltered(config) || !almanacOneDay(config)) return ['text', 'date', 'lunar', 'count'];
  return ['text', 'lunar', 'date', 'yi', 'ji', 'dayType', 'count', ...((config.time ?? '').trim() ? ['eightChar'] : [])];
}

// youtube_info writes its own isFailed into its output, so the menu lists it beside the executor's set.
const FAIL_FLAG_SKILLS: ReadonlySet<SkillType> = new Set<SkillType>([...FAIL_SOFT_SKILLS, 'youtube_info']);

/** The sub-fields a step's output offers besides itself, by what the step is set to. */
export function stepSubfields(s: SkillInstance): string[] {
  const failFlag = FAIL_FLAG_SKILLS.has(s.type) && s.config.emitFailFlag === 'true' ? ['isFailed'] : [];
  switch (s.type) {
    case 'llm': {
      const formats = parseLlmExportFormats(s.config.exportFormat);
      if (formats.length === 0) return ['text', ...failFlag];
      const files = [...new Set([...formats, ...(formats.some((format) => format !== 'pdf') ? ['pdf'] : [])])];
      return ['text', 'file', ...files, ...failFlag];
    }
    // `.note` is set only when some of its searches were blocked; empty otherwise.
    case 'research': return [...failFlag, 'sources', 'count', 'note'];
    case 'youtube': return ['title', 'isFailed', 'image'];
    case 'youtube_info': return ['url', 'quality', 'download', 'buttons', 'title', 'channel', 'duration', 'image', 'notice', 'downloadReady', 'available', ...failFlag];
    case 'youtube_download': return ['savedLocally', 'summary', 'title', 'quality', 'kind', 'sizeMb', 'fileName', ...failFlag];
    // The runner skips the cover for more than one row, so `.image` would only ever be empty.
    case 'browser': return [
      ...browserPages(s.config), ...failFlag,
      ...(s.config.includeImage === 'true' && parseBrowserUrlRows(s.config.url ?? '').length === 1 ? ['image'] : []),
    ];
    case 'x_thread': return ['text', 'author', 'name', 'date', 'link', 'replyText', 'replies', 'shown', 'replyCount', 'image', 'platform', 'subject', ...failFlag];
    case 'x_media': return ['count', 'kind', 'message', 'caption', 'overflow', 'lead', 'rest', 'previews', 'text', 'author', 'name', 'date', 'link', 'prompt', 'videoText', 'savedLocally', 'summary', 'notice', ...failFlag];
    case 'browser_open': return ['title', 'url', ...failFlag];
    case 'share': return isShareLinkFormat(s.config.format)
      ? ['url', 'kind', 'deleteUrl', 'expire', 'summary', 'burn', ...failFlag]
      : ['path', 'kind', 'format', 'summary', 'fellBack', 'zipped', ...failFlag];
    case 'gmap_reviews': return ['place', 'rating', 'total', 'distribution', 'positive', 'verdict', 'tier', ...failFlag];
    case 'line_read': return ['count', 'dropped', 'chatName', 'chatCount', 'firstAt', 'lastAt', 'isFirstRun', ...failFlag];
    case 'telegram_read': return ['count', 'dropped', 'groupNames', 'groupCount', 'firstAt', 'lastAt', ...failFlag];
    case 'stock': return splitSymbols(s.config.symbol).length > 1 ? [] : ['price', 'changePct', 'name', 'currency', ...historyFields(s.config), 'isFailed'];
    case 'forex': return ['rate', 'converted', 'asOf', 'session', 'previousClose', 'changePct', ...historyFields(s.config), 'isFailed'];
    case 'weather': return weatherFields(s.config);
    case 'air_quality': return ['aqi', 'level', 'status', 'statusLocal', 'pollutant', 'pm2_5', 'station', 'isFailed'];
    case 'almanac': return almanacFields(s.config);
    case 'tw_invoice': return ['text', 'won', 'count', 'period', 'label', 'drawnAt', 'claimUntil', 'newThisMonth'];
    case 'calendar': return [...failFlag, 'text', 'count', 'calendar', 'from', 'to'];
    case 'mail_fetch': return [...failFlag, 'text', 'count'];
    case 'on_change': return s.config.withDiff === 'true' ? [...ON_CHANGE_DIFF_FIELDS] : [];
    case 'mcp': return ['truncated', ...failFlag];
    case 'sysinfo': return resolveSysInfoSelection(s.config);
    default: return failFlag;
  }
}

export interface VarToken {
  /** The text inserted, braces included. */
  token: string;
  /** What it holds, when the token alone does not say. */
  hint?: string;
}

export interface VarGroup {
  key: string;
  title: string;
  tokens: VarToken[];
}

export interface AvailableVarsInput {
  /** Earlier steps with an output, in order. */
  prevSteps: SkillInstance[];
  /** Every earlier step, for the card numbers and for outputs not listed as a step's own. */
  allPrevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  hasHotkeyTrigger?: boolean;
  /** A file trigger seeds {{file}} and {{file.name}} from the first step on. */
  hasFileTrigger?: boolean;
  loopVars?: LoopVarHint[];
  flowVariables?: FlowVariable[];
}

const braces = (name: string): string => `{{${name}}}`;

/**
 * The earlier steps whose outputs still exist here: a loop's body outputs end at its end_loop, as
 * `findReferenceIssues` and the runner's per-item context copy have it.
 */
function stepsInScope(allPrevSteps: SkillInstance[]): Set<string> {
  const visible = new Set<string>();
  const frames: string[][] = [];
  for (const s of allPrevSteps) {
    visible.add(s.id);
    frames.at(-1)?.push(s.id);
    if (s.type === 'loop') frames.push([]);
    else if (s.type === 'end_loop') for (const id of frames.pop() ?? []) visible.delete(id);
  }
  return visible;
}

/**
 * The earlier steps inside a condition that has already ended: they ran only when it held, so
 * after its end their outputs are "" whenever it did not (a condition opens no scope of its own).
 */
function stepsUnderClosedIf(allPrevSteps: SkillInstance[]): Set<string> {
  const guarded = new Set<string>();
  const frames: string[][] = [];
  for (const s of allPrevSteps) {
    if (s.type === 'end_if') {
      for (const id of frames.pop() ?? []) guarded.add(id);
      continue;
    }
    frames.at(-1)?.push(s.id);
    if (s.type === 'if') frames.push([]);
  }
  return guarded;
}

/**
 * The active loop variables, outermost first, as the runner binds them: names trimmed, and a
 * name reused by an inner loop hides the outer one for the whole inner body, so only the
 * innermost of each name is listed.
 */
function visibleLoops(loopVars: LoopVarHint[]): Array<LoopVarHint & { shadows: boolean }> {
  const loops = loopVars.map((loop) => ({ ...loop, name: loop.name.trim() || 'item' }));
  return loops
    .map((loop, i) => ({ ...loop, shadows: loops.slice(0, i).some((outer) => outer.name === loop.name) }))
    .filter((loop, i) => !loops.slice(i + 1).some((inner) => inner.name === loop.name));
}

function outputHint(step: SkillInstance, name: string, t: (key: string) => string): string | undefined {
  if (step.type === 'browser' && name === step.outputKey) return t('flow.insertData.browserAll');
  const subfield = name.slice(step.outputKey.length + 1);
  if (step.type === 'llm') {
    // With an export the bare output is the last file, no longer the answer.
    if (name === step.outputKey) {
      return t(parseLlmExportFormats(step.config.exportFormat).length > 0 ? 'flow.insertData.answerFile' : 'flow.insertData.answerText');
    }
    if (subfield === 'text') return t('flow.insertData.answerText');
    if (subfield === 'file') return t('flow.insertData.answerFile');
    if (isCaptureFormat(subfield)) {
      if (subfield === 'pdf' && !parseLlmExportFormats(step.config.exportFormat).includes('pdf')) return t('flow.insertData.answerPdfFallback');
      return fillTemplate(t('flow.insertData.answerFormat'), { format: subfield.toUpperCase() });
    }
  }
  if (step.type === 'research' && subfield === 'note') return t('flow.insertData.researchNote');
  if (step.type === 'share') {
    if (subfield === 'path') return t('flow.insertData.shareFile');
    if (subfield === 'url') return t('flow.insertData.shareUrl');
    if (subfield === 'kind') return t('flow.insertData.shareKind');
    if (subfield === 'summary') return t('flow.insertData.shareSummary');
  }
  if (step.type === 'browser' && /^page\d+$/.test(subfield)) {
    return fillTemplate(t('flow.insertData.browserPage'), { number: subfield.slice(4) });
  }
  return undefined;
}

/**
 * What a step's fields can take from the flow, grouped by where it comes from: each earlier step
 * is a group under its card number and name, so "#4 Read article" says where `{{page}}` comes
 * from without the user matching output names to cards.
 */
export function availableVarGroups(input: AvailableVarsInput, t: (key: string) => string): VarGroup[] {
  const {
    prevSteps, allPrevSteps, flowTrigger, hasHotkeyTrigger = false, hasFileTrigger = false, loopVars = [], flowVariables = [],
  } = input;
  const groups: VarGroup[] = [];

  const general: VarToken[] = [
    { token: braces('clipboard'), hint: t('flow.insertData.clipboard') },
    { token: braces('timestamp'), hint: t('flow.insertData.timestamp') },
  ];
  if (hasHotkeyTrigger) general.push({ token: braces('selection'), hint: t('flow.availableVars.selectionHint') });
  groups.push({ key: 'general', title: t('flow.insertData.general'), tokens: general });

  if (flowVariables.length > 0) {
    groups.push({
      key: 'settings',
      title: t('flow.variables'),
      tokens: flowVariables.map((variable) => ({ token: braces(`${FLOW_VAR_PREFIX}.${variable.key}`), hint: variable.label || undefined })),
    });
  }

  const inScope = stepsInScope(allPrevSteps);
  // {{file}} is the latest file step's file (a screen capture has no output name of its own), so
  // it sits under that step's card; the trigger's file is {{file}} only until a step makes one.
  // A file made inside a loop that has ended is gone with the rest of its body's outputs.
  const fileStep = [...allPrevSteps].reverse().find((s) => inScope.has(s.id) && isFileOutputStep(s.type, s.config));
  const trigger: VarToken[] = [];
  if (hasFileTrigger) {
    if (!fileStep) trigger.push({ token: braces('file'), hint: t('flow.availableVars.triggerFileHint') });
    trigger.push({ token: braces('file.name'), hint: t('flow.availableVars.triggerFileNameHint') });
  }
  const inputVar = flowTrigger?.type === 'bot'
    ? (flowTrigger.botInputVariable?.trim() || 'input')
    : flowTrigger?.type === 'chat'
      ? (flowTrigger.chatInputVariable?.trim() || 'input')
      : undefined;
  if (inputVar) trigger.push({ token: braces(inputVar) });
  if (flowTrigger?.type === 'bot') {
    for (const name of ['bot.triggerChatId', 'bot.triggerUserId', 'bot.triggerPlatform']) trigger.push({ token: braces(name) });
  }
  if (trigger.length > 0) groups.push({ key: 'trigger', title: t('flow.insertData.trigger'), tokens: trigger });

  for (const loop of visibleLoops(loopVars)) {
    const tokens: VarToken[] = [loop.name, ...loopSubfields(loop.sourceType).map((sub) => `${loop.name}.${sub}`)].map((name) => ({ token: braces(name) }));
    if (loop.shadows) tokens[0].hint = fillTemplate(t('flow.issue.block.shadowedLoopVar'), { token: braces(loop.name) });
    groups.push({
      key: `loop-${loop.name}`,
      title: fillTemplate(t('flow.insertData.loop'), { name: loop.name }),
      tokens,
    });
  }

  const withOutput = new Set(prevSteps.map((s) => s.id));
  const underClosedIf = stepsUnderClosedIf(allPrevSteps);
  allPrevSteps.forEach((s, index) => {
    if (!inScope.has(s.id)) return;
    let names: string[] = [];
    if (withOutput.has(s.id)) names = [s.outputKey, ...stepSubfields(s).map((sub) => `${s.outputKey}.${sub}`)];
    // A Bot step has no output of its own, only whether it failed to send.
    else if (s.type === 'bot' && s.config.emitFailFlag === 'true' && s.outputKey) names = [`${s.outputKey}.isFailed`];
    const tokens: VarToken[] = names.map((name) => ({
      token: braces(name),
      hint: outputHint(s, name, t),
    }));
    if (tokens[0] && underClosedIf.has(s.id)) {
      const guarded = t('flow.insertData.ifGuarded');
      tokens[0].hint = tokens[0].hint ? `${tokens[0].hint} · ${guarded}` : guarded;
    }
    if (s === fileStep) tokens.unshift({ token: braces('file'), hint: t('flow.availableVars.fileHint') });
    if (tokens.length === 0) return;
    groups.push({
      key: s.id,
      title: fillTemplate(t('flow.insertData.step'), { step: String(index + 1), name: s.label.trim() || t(`flow.skill.${s.type}`) }),
      tokens,
    });
  });

  return groups;
}

/**
 * The one way into a step's fields from the flow's data: a menu by source (earlier steps by card
 * number and name) that inserts at the caret of the field last focused in the card.
 */
export const InsertDataMenu: React.FC<{
  /** Read when the menu opens, so a card is not drawn again for every edit above it. */
  varInput: () => AvailableVarsInput;
  onInsert: (token: string) => void;
  t: (k: string) => string;
}> = ({ varInput, onInsert, t }) => {
  return (
    // returnFocus off: the insert puts the caret back in the field, and the menu must not take it.
    <Menu position="bottom-start" returnFocus={false} shadow="md">
      <Menu.Target>
        <Tooltip label={t('flow.insertData.hint')} position="top">
          <AppButton
            variant="subtle"
            size="compact-xs"
            leftSection={<Braces size={13} />}
            style={{ alignSelf: 'flex-start' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {t('flow.insertData')}
          </AppButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown {...INSERT_DATA_DROPDOWN}>
        <InsertDataGroups varInput={varInput} onInsert={onInsert} t={t} />
      </Menu.Dropdown>
    </Menu>
  );
};

/** The list is long (every earlier step's outputs): it scrolls inside a fixed box. */
const INSERT_DATA_DROPDOWN = { mah: 360, maw: 360, style: { overflowY: 'auto' } } as const;

/** The tokens by source, as items: the 「插入資料」 button's menu and the right-click submenu. */
export const InsertDataItems: React.FC<{ groups: VarGroup[]; onInsert: (token: string) => void }> = ({ groups, onInsert }) => (
  <>
    {groups.map((group) => (
      <React.Fragment key={group.key}>
        <Menu.Label>{group.title}</Menu.Label>
        {group.tokens.map(({ token, hint }) => (
          <Menu.Item key={token} onClick={() => onInsert(token)}>
            <Stack gap={0}>
              <Code fz="xs" c="dimmed" style={{ alignSelf: 'flex-start' }}>{token}</Code>
              {hint && <Text fz="xs" c="dimmed" lineClamp={2}>{hint}</Text>}
            </Stack>
          </Menu.Item>
        ))}
      </React.Fragment>
    ))}
  </>
);

/** The groups, built only while a dropdown that shows them is open. */
const InsertDataGroups: React.FC<{
  varInput: () => AvailableVarsInput;
  onInsert: (token: string) => void;
  t: (k: string) => string;
}> = ({ varInput, onInsert, t }) => {
  const input = varInput();
  return <InsertDataItems groups={availableVarGroups(input, t)} onInsert={onInsert} />;
};

/**
 * 「插入資料 ▸」 in a step field's right-click menu: the same groups as the button, inserted where
 * the right-click was (`insert` restores that field's caret).
 */
export const InsertDataSubmenu: React.FC<{
  varInput: () => AvailableVarsInput;
  insert: (token: string) => void;
  t: (k: string) => string;
}> = ({ varInput, insert, t }) => (
  <Menu.Sub position="right-start">
    <Menu.Sub.Target>
      <Menu.Sub.Item leftSection={<Braces size={13} />}>{t('flow.insertData')}</Menu.Sub.Item>
    </Menu.Sub.Target>
    <Menu.Sub.Dropdown {...INSERT_DATA_DROPDOWN}>
      <InsertDataGroups varInput={varInput} onInsert={insert} t={t} />
    </Menu.Sub.Dropdown>
  </Menu.Sub>
);
