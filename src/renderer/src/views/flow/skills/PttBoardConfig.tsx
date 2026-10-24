import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Autocomplete, Badge, Button, Group, Input, Stack, Text } from '@mantine/core';
import type { OptionsFilter } from '@mantine/core';
import { BookmarkCheck, Trash2 } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { buildInputStyles } from '../../../components/inputStyles';
import { Z_POPOVER } from '../../../config/zLayers';
import { ipcEvents, pttBoardApi } from '../../../api/electronApi';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import {
  parsePttScore,
  parsePttScoreMode,
  pttKeywordHasOperator,
  type PttBoardChoice,
} from '../../../../../shared/pttBoard';
import { PttBoardPreview, type PttBoardPreviewQuery } from './PttBoardPreview';
import type { SkillConfigProps } from './types';

/** Quiet time after a keystroke before the board directory is searched (it is local, so short). */
const BOARD_SEARCH_DEBOUNCE_MS = 150;

const BOARD_INPUT_STYLES = {
  ...buildInputStyles({ tone: 'default' }),
  dropdown: {
    background: 'var(--mantine-color-bg-tertiary)',
    borderColor: 'var(--mantine-color-default-border)',
  },
  option: { fontSize: 'var(--font-size-base)' },
};

/** The main process already ranked the boards for what was typed; the dropdown keeps its order. */
const KEEP_ORDER: OptionsFilter = ({ options }) => options;

function hasVariable(value: string): boolean {
  return value.includes('{{');
}

function choiceLine(choice: PttBoardChoice): string {
  return [choice.board, choice.cls, choice.title].filter(Boolean).join(' · ');
}

/** The boards matching what is typed, searched in the directory main keeps. */
function useBoardChoices(typed: string): PttBoardChoice[] {
  const [choices, setChoices] = useState<PttBoardChoice[]>([]);
  useEffect(() => {
    const query = typed.trim();
    if (!query || hasVariable(query)) {
      setChoices([]);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      void pttBoardApi.findBoards(query).then((found) => {
        if (current) setChoices(found);
      }, () => {
        if (current) setChoices([]);
      });
    }, BOARD_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed]);
  return choices;
}

function useCheckpoint(stepId: string): [boolean, () => Promise<void>] {
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  useEffect(() => {
    void pttBoardApi.hasCheckpoint(stepId).then(setHasCheckpoint);
    return ipcEvents.onFlowExecutionEnded(() => {
      void pttBoardApi.hasCheckpoint(stepId).then(setHasCheckpoint);
    });
  }, [stepId]);
  const clear = useCallback(async () => {
    await pttBoardApi.clearCheckpoint(stepId);
    setHasCheckpoint(false);
  }, [stepId]);
  return [hasCheckpoint, clear];
}

export const PttBoardConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const board = step.config.board ?? '';
  const keyword = step.config.keyword ?? '';
  const scoreMode = parsePttScoreMode(step.config.scoreMode);
  const score = step.config.score ?? '';
  const choices = useBoardChoices(board);
  const [hasCheckpoint, clearCheckpoint] = useCheckpoint(step.id);

  const keywordError = !hasVariable(keyword) && pttKeywordHasOperator(keyword);
  const scoreError = scoreMode !== 'none' && !hasVariable(score) && parsePttScore(score) === null;

  const byBoard = useMemo(() => new Map(choices.map((choice) => [choice.board, choice])), [choices]);

  const previewQuery = useMemo((): PttBoardPreviewQuery | null => {
    const fields = [board, keyword, score];
    if (!board.trim() || fields.some(hasVariable) || keywordError || scoreError) return null;
    return { board: board.trim(), keyword: keyword.trim(), scoreMode, score: score.trim() };
  }, [board, keyword, score, scoreMode, keywordError, scoreError]);

  const set = (patch: Record<string, string>): void => onChange({ ...step.config, ...patch });

  // A board typed in another case takes the directory's spelling once the list has it.
  const settleBoard = (): void => {
    const typed = board.trim().toLowerCase();
    const match = choices.find((choice) => choice.board.toLowerCase() === typed);
    if (match && match.board !== board) set({ board: match.board });
  };

  return (
    <Stack gap="xs">
      <Autocomplete
        label={t('flow.skill.ptt_board.board')}
        placeholder={t('flow.skill.ptt_board.board.placeholder')}
        value={board}
        onChange={(value) => set({ board: value })}
        onOptionSubmit={(value) => set({ board: value })}
        onBlur={settleBoard}
        data={choices.map((choice) => choice.board)}
        filter={KEEP_ORDER}
        renderOption={({ option }) => {
          const choice = byBoard.get(option.value);
          return <Text fz="sm">{choice ? choiceLine(choice) : option.value}</Text>;
        }}
        comboboxProps={{ zIndex: Z_POPOVER }}
        maxDropdownHeight={260}
        size="sm"
        styles={BOARD_INPUT_STYLES}
      />

      <AppTextInput
        label={t('flow.skill.ptt_board.keyword')}
        placeholder={t('flow.skill.ptt_board.keyword.placeholder')}
        value={keyword}
        onChange={(e) => set({ keyword: e.currentTarget.value })}
        error={keywordError ? fillTemplate(t('flow.error.pttKeywordOperator'), { keyword: keyword.trim() }) : undefined}
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.ptt_board.keyword.hint')}</Text>

      <Input.Wrapper label={t('flow.skill.ptt_board.scoreMode')}>
        <AppSegmentedControl
          value={scoreMode}
          onChange={(value) => set({ scoreMode: value })}
          options={[
            { value: 'none', label: t('flow.skill.ptt_board.scoreMode.none') },
            { value: 'push', label: t('flow.skill.ptt_board.scoreMode.push') },
            { value: 'boo', label: t('flow.skill.ptt_board.scoreMode.boo') },
          ]}
          size="sm"
        />
      </Input.Wrapper>
      {/* A number input cannot hold `{{var.…}}` (the templates' score): it would show blank and the first digit would overwrite it. */}
      {scoreMode !== 'none' && hasVariable(score) && (
        <AppTextInput
          label={t('flow.skill.ptt_board.score')}
          value={score}
          onChange={(e) => set({ score: e.currentTarget.value })}
          mono
        />
      )}
      {scoreMode !== 'none' && !hasVariable(score) && (
        <AppNumberInput
          label={t('flow.skill.ptt_board.score')}
          value={score}
          onChange={(v) => set({ score: v === '' ? '' : String(v) })}
          size="sm"
          min={1}
          max={100}
          step={10}
          allowDecimal={false}
          allowNegative={false}
          error={scoreError ? t('flow.skill.ptt_board.score.error') : undefined}
        />
      )}

      <Text fz="xs" c="dimmed">{t('flow.skill.ptt_board.hint')}</Text>

      <PttBoardPreview query={previewQuery} t={t} />

      {hasCheckpoint && (
        <Group gap="xs" align="center">
          <Badge variant="light" color="var(--mantine-color-success)" size="sm" leftSection={<BookmarkCheck size={12} />}>
            {t('flow.skill.ptt_board.stateActive')}
          </Badge>
        </Group>
      )}

      <Button
        variant="light"
        color="red"
        size="xs"
        leftSection={<Trash2 size={14} />}
        onClick={() => void clearCheckpoint()}
        disabled={!hasCheckpoint}
      >
        {t('flow.skill.ptt_board.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.ptt_board.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
