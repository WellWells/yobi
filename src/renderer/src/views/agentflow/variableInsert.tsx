import React from 'react';
import { Code, Group, Text, Tooltip } from '@mantine/core';
import type { SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';

export interface LoopVarHint {
  name: string;
  sourceType?: SkillType;
}

// The subfields each list-producing skill actually emits per loop item; keeping
// this in sync with the skill output contract stops the panel advertising
// {{item.image}} for loops that never carry one.
function loopSubfields(sourceType?: SkillType): string[] {
  switch (sourceType) {
    case 'youtube_subs': return ['title', 'link', 'image'];
    case 'scraper':
    case 'file_list': return ['title', 'link'];
    case 'rss':
    case 'random': return [];
    default: return ['title', 'link'];
  }
}

export function insertTokenAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement,
  token: string,
): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + token + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = start + token.length;
  el.setSelectionRange(caret, caret);
  el.focus();
}

const VarChip: React.FC<{
  token: string;
  color?: string;
  insertHint: string;
  onInsert: (token: string) => void;
}> = ({ token, color, insertHint, onInsert }) => {
  const label = `{{${token}}}`;
  return (
    <Tooltip label={insertHint} position="top">
      <Code
        fz="xs"
        c={color}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onInsert(label)}
      >
        {label}
      </Code>
    </Tooltip>
  );
};

function isFileProducerStep(s: SkillInstance): boolean {
  return s.type === 'file_write' || s.type === 'capture' || s.type === 'file_download'
    || (s.type === 'llm' && ['png', 'webp', 'pdf'].includes(s.config.exportFormat ?? ''));
}

export const AvailableVarsHint: React.FC<{
  prevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  loopVars?: LoopVarHint[];
  allPrevSteps?: SkillInstance[];
  onInsert: (token: string) => void;
  t: (k: string) => string;
}> = ({ prevSteps, flowTrigger, loopVars = [], allPrevSteps = [], onInsert, t }) => {
  const insertHint = t('agentflow.availableVars.insert');
  const inputVar = flowTrigger?.type === 'bot'
    ? (flowTrigger.botInputVariable?.trim() || 'input')
    : undefined;
  const hasFileOutput = allPrevSteps.some(isFileProducerStep);
  const botFailSteps = allPrevSteps.filter(
    (s) => s.type === 'bot' && s.config.emitFailFlag === 'true' && s.outputKey,
  );

  return (
    <Group gap={6} wrap="wrap" align="center">
      <Text fz="xs" c="dimmed">{t('agentflow.availableVars')}</Text>
      <VarChip token="clipboard" color="dimmed" insertHint={insertHint} onInsert={onInsert} />
      <VarChip token="timestamp" color="dimmed" insertHint={insertHint} onInsert={onInsert} />
      {hasFileOutput && (
        <VarChip token="file" color="green" insertHint={t('agentflow.availableVars.fileHint')} onInsert={onInsert} />
      )}
      {inputVar && (
        <VarChip token={inputVar} color="teal" insertHint={insertHint} onInsert={onInsert} />
      )}
      {flowTrigger?.type === 'bot' && (
        <>
          <VarChip token="bot.triggerChatId" color="teal" insertHint={insertHint} onInsert={onInsert} />
          <VarChip token="bot.triggerUserId" color="teal" insertHint={insertHint} onInsert={onInsert} />
        </>
      )}
      {loopVars.map((v) => (
        <React.Fragment key={v.name}>
          <VarChip token={v.name} color="orange" insertHint={insertHint} onInsert={onInsert} />
          {loopSubfields(v.sourceType).map((sub) => (
            <VarChip key={sub} token={`${v.name}.${sub}`} color="orange" insertHint={insertHint} onInsert={onInsert} />
          ))}
        </React.Fragment>
      ))}
      {prevSteps.map((s) => (
        <React.Fragment key={s.id}>
          <VarChip token={s.outputKey} color="blue" insertHint={insertHint} onInsert={onInsert} />
          {s.type === 'llm' && s.config.emitFailFlag === 'true' && (
            <VarChip token={`${s.outputKey}.isFailed`} color="grape" insertHint={insertHint} onInsert={onInsert} />
          )}
          {s.type === 'youtube' && (
            <>
              <VarChip token={`${s.outputKey}.title`} color="grape" insertHint={insertHint} onInsert={onInsert} />
              <VarChip token={`${s.outputKey}.isFailed`} color="grape" insertHint={insertHint} onInsert={onInsert} />
              <VarChip token={`${s.outputKey}.image`} color="grape" insertHint={insertHint} onInsert={onInsert} />
            </>
          )}
          {(s.type === 'rss' || s.type === 'browser') && s.config.includeImage === 'true' && (
            <VarChip token={`${s.outputKey}.image`} color="grape" insertHint={insertHint} onInsert={onInsert} />
          )}
          {s.type === 'stock' && !/[,\n]/.test(s.config.symbol ?? '') && (
            ['price', 'changePct', 'name', 'currency', 'isFailed'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} color="grape" insertHint={insertHint} onInsert={onInsert} />
            ))
          )}
          {s.type === 'forex' && ['rate', 'converted', 'asOf', 'isFailed'].map((sub) => (
            <VarChip key={sub} token={`${s.outputKey}.${sub}`} color="grape" insertHint={insertHint} onInsert={onInsert} />
          ))}
          {s.type === 'weather' && ['temp', 'condition', 'high', 'low', 'isFailed'].map((sub) => (
            <VarChip key={sub} token={`${s.outputKey}.${sub}`} color="grape" insertHint={insertHint} onInsert={onInsert} />
          ))}
        </React.Fragment>
      ))}
      {botFailSteps.map((s) => (
        <VarChip key={`${s.id}-fail`} token={`${s.outputKey}.isFailed`} color="grape" insertHint={insertHint} onInsert={onInsert} />
      ))}
    </Group>
  );
};
