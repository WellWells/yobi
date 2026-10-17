import React from 'react';
import { Code, Group, Text, Tooltip } from '@mantine/core';
import { FLOW_VAR_PREFIX } from '../../../../shared/flowVariables';
import { resolveSysInfoSelection } from '../../../../shared/sysinfoFields';
import { isShareLinkFormat } from '../../../../shared/shareFormat';
import type { FlowVariable, SkillInstance, SkillType, TriggerConfig } from '../../../../shared/types';

export interface LoopVarHint {
  name: string;
  sourceType?: SkillType;
}

function loopSubfields(sourceType?: SkillType): string[] {
  switch (sourceType) {
    case 'youtube_subs': return ['title', 'link', 'image'];
    case 'x_posts': return ['title', 'link', 'author', 'name', 'date', 'text', 'image', 'replies', 'likes'];
    case 'x_trends': return ['title', 'link', 'context', 'volume', 'rank', 'posts'];
    // Only {{thread.replies}} is a list; the step's own output is text.
    case 'x_thread': return ['author', 'name', 'date', 'text', 'link', 'likes'];
    case 'search': return ['title', 'link', 'snippet'];
    case 'gmap_reviews': return ['author', 'rating', 'date', 'text', 'reply'];
    case 'rss':
    case 'scraper':
    case 'research':
    case 'file_list': return ['title', 'link'];
    case 'random':
    case 'on_change': return [];
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
  insertHint: string;
  onInsert: (token: string) => void;
}> = ({ token, insertHint, onInsert }) => {
  const label = `{{${token}}}`;
  return (
    <Tooltip label={insertHint} position="top">
      <Code
        fz="xs"
        c="dimmed"
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
    || (s.type === 'share' && !isShareLinkFormat(s.config.format))
    || (s.type === 'llm' && ['png', 'webp', 'pdf'].includes(s.config.exportFormat ?? ''));
}

export const AvailableVarsHint: React.FC<{
  prevSteps: SkillInstance[];
  flowTrigger?: TriggerConfig;
  hasHotkeyTrigger?: boolean;
  loopVars?: LoopVarHint[];
  allPrevSteps?: SkillInstance[];
  flowVariables?: FlowVariable[];
  onInsert: (token: string) => void;
  t: (k: string) => string;
}> = ({
  prevSteps, flowTrigger, hasHotkeyTrigger = false, loopVars = [], allPrevSteps = [],
  flowVariables = [], onInsert, t,
}) => {
  const insertHint = t('flow.availableVars.insert');
  const inputVar = flowTrigger?.type === 'bot'
    ? (flowTrigger.botInputVariable?.trim() || 'input')
    : flowTrigger?.type === 'chat'
      ? (flowTrigger.chatInputVariable?.trim() || 'input')
      : undefined;
  const hasFileOutput = allPrevSteps.some(isFileProducerStep);
  const botFailSteps = allPrevSteps.filter(
    (s) => s.type === 'bot' && s.config.emitFailFlag === 'true' && s.outputKey,
  );
  const stepNo = new Map(allPrevSteps.map((s, i) => [s.id, i + 1]));
  const stepHint = (s: SkillInstance): string => {
    const n = stepNo.get(s.id);
    return n ? t('flow.availableVars.stepHint').replace('{{step}}', String(n)) : insertHint;
  };

  return (
    <Group gap={6} wrap="wrap" align="center">
      <Text fz="xs" c="dimmed">{t('flow.availableVars')}</Text>
      <VarChip token="clipboard" insertHint={insertHint} onInsert={onInsert} />
      <VarChip token="timestamp" insertHint={insertHint} onInsert={onInsert} />
      {hasHotkeyTrigger && (
        <VarChip token="selection" insertHint={t('flow.availableVars.selectionHint')} onInsert={onInsert} />
      )}
      {flowVariables.map((variable) => (
        <VarChip
          key={variable.key}
          token={`${FLOW_VAR_PREFIX}.${variable.key}`}
          insertHint={variable.label || insertHint}
          onInsert={onInsert}
        />
      ))}
      {hasFileOutput && (
        <VarChip token="file" insertHint={t('flow.availableVars.fileHint')} onInsert={onInsert} />
      )}
      {inputVar && (
        <VarChip token={inputVar} insertHint={insertHint} onInsert={onInsert} />
      )}
      {flowTrigger?.type === 'bot' && (
        <>
          <VarChip token="bot.triggerChatId" insertHint={insertHint} onInsert={onInsert} />
          <VarChip token="bot.triggerUserId" insertHint={insertHint} onInsert={onInsert} />
          <VarChip token="bot.triggerPlatform" insertHint={insertHint} onInsert={onInsert} />
        </>
      )}
      {loopVars.map((v) => (
        <React.Fragment key={v.name}>
          <VarChip token={v.name} insertHint={insertHint} onInsert={onInsert} />
          {loopSubfields(v.sourceType).map((sub) => (
            <VarChip key={sub} token={`${v.name}.${sub}`} insertHint={insertHint} onInsert={onInsert} />
          ))}
        </React.Fragment>
      ))}
      {prevSteps.map((s) => {
        const hint = stepHint(s);
        return (
          <React.Fragment key={s.id}>
            <VarChip token={s.outputKey} insertHint={hint} onInsert={onInsert} />
            {(s.type === 'llm' || s.type === 'browser' || s.type === 'research') && s.config.emitFailFlag === 'true' && (
              <VarChip token={`${s.outputKey}.isFailed`} insertHint={hint} onInsert={onInsert} />
            )}
            {s.type === 'research' && ['sources', 'count'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'youtube' && (
              <>
                <VarChip token={`${s.outputKey}.title`} insertHint={hint} onInsert={onInsert} />
                <VarChip token={`${s.outputKey}.isFailed`} insertHint={hint} onInsert={onInsert} />
                <VarChip token={`${s.outputKey}.image`} insertHint={hint} onInsert={onInsert} />
              </>
            )}
            {s.type === 'youtube_info' && ['url', 'quality', 'download', 'buttons', 'title', 'image', 'notice', 'downloadReady', 'available'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'youtube_info' && s.config.emitFailFlag === 'true' && (
              <VarChip token={`${s.outputKey}.isFailed`} insertHint={hint} onInsert={onInsert} />
            )}
            {s.type === 'youtube_download' && ['savedLocally', 'summary', 'title', 'quality', 'kind', 'sizeMb', 'fileName'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'youtube_download' && s.config.emitFailFlag === 'true' && (
              <VarChip token={`${s.outputKey}.isFailed`} insertHint={hint} onInsert={onInsert} />
            )}
            {s.type === 'x_thread' && ['text', 'author', 'date', 'link', 'replyText', 'replies', 'shown', 'replyCount', 'image', 'platform'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'x_media' && ['count', 'kind', 'message', 'caption', 'overflow', 'previews', 'text', 'author', 'name', 'date', 'link', 'prompt', 'videoText', 'savedLocally', 'summary', 'notice'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'x_thread' && s.config.emitFailFlag === 'true' && (
              <VarChip token={`${s.outputKey}.isFailed`} insertHint={hint} onInsert={onInsert} />
            )}
            {s.type === 'browser' && s.config.includeImage === 'true' && (
              <VarChip token={`${s.outputKey}.image`} insertHint={hint} onInsert={onInsert} />
            )}
            {s.type === 'stock' && !/[,\n]/.test(s.config.symbol ?? '') && (
              ['price', 'changePct', 'name', 'currency', 'isFailed'].map((sub) => (
                <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
              ))
            )}
            {s.type === 'forex' && ['rate', 'converted', 'asOf', 'previousClose', 'changePct', 'isFailed'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'weather' && ['temp', 'condition', 'high', 'low', 'isFailed'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'air_quality' && ['aqi', 'level', 'status', 'statusLocal', 'pollutant', 'pm2_5', 'station', 'isFailed'].map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
            {s.type === 'sysinfo' && resolveSysInfoSelection(s.config).map((sub) => (
              <VarChip key={sub} token={`${s.outputKey}.${sub}`} insertHint={hint} onInsert={onInsert} />
            ))}
          </React.Fragment>
        );
      })}
      {botFailSteps.map((s) => (
        <VarChip key={`${s.id}-fail`} token={`${s.outputKey}.isFailed`} insertHint={stepHint(s)} onInsert={onInsert} />
      ))}
    </Group>
  );
};
