import React, { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Input, SimpleGrid, Stack, Text } from '@mantine/core';
import type { OptionsFilter } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { buildInputStyles } from '../../../components/inputStyles';
import { Z_POPOVER } from '../../../config/zLayers';
import { pttBoardApi } from '../../../api/electronApi';
import { useSeenOnScreen } from '../../../hooks/useSeenOnScreen';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import {
  parsePttScore,
  parsePttScoreMode,
  pttKeywordHasOperator,
  type PttBoardChoice,
} from '../../../../../shared/pttBoard';
import { PttBoardPreview, type PttBoardPreviewQuery } from './PttBoardPreview';
import { SeenRecordRow, useSeenRecord } from './SeenRecordRow';
import type { SkillConfigProps } from './types';

/** Quiet time after a keystroke before the board directory is searched (it is local, so short). */
const BOARD_SEARCH_DEBOUNCE_MS = 150;

/** A card at least this wide puts the score condition and the score side by side. */
const SCORE_SIDE_BY_SIDE_FROM = '640px';

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

/** The fields that make the step's query: another value is a new query, which the next run seeds. */
function queryOf(config: Record<string, string>): string {
  return [config.board, config.keyword, parsePttScoreMode(config.scoreMode), config.score].map((value) => (value ?? '').trim()).join('\n');
}

export const PttBoardConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const board = step.config.board ?? '';
  const keyword = step.config.keyword ?? '';
  const scoreMode = parsePttScoreMode(step.config.scoreMode);
  const score = step.config.score ?? '';
  const choices = useBoardChoices(board);
  const [boxRef, onScreen] = useSeenOnScreen();
  const [hasRecord, clearRecord] = useSeenRecord(step.id, pttBoardApi);
  const [openedWith] = useState(() => queryOf(step.config));
  const [boardFocused, setBoardFocused] = useState(false);
  const [boardTouched, setBoardTouched] = useState(false);

  const keywordError = !hasVariable(keyword) && pttKeywordHasOperator(keyword);
  const scoreError = scoreMode !== 'none' && !hasVariable(score) && parsePttScore(score) === null;
  const fromSetting = [board, keyword, scoreMode === 'none' ? '' : score].some(hasVariable);

  const byBoard = useMemo(() => new Map(choices.map((choice) => [choice.board, choice])), [choices]);
  // While the board is still being typed ("Gos"), reading it would flash "no such board".
  const typedBoard = board.trim().toLowerCase();
  const boardSettled = !boardFocused || choices.some((choice) => choice.board.toLowerCase() === typedBoard);

  const previewQuery = useMemo((): PttBoardPreviewQuery | null => {
    if (!onScreen || !boardSettled) return null;
    const fields = [board, keyword, score];
    if (!board.trim() || fields.some(hasVariable) || keywordError || scoreError) return null;
    return { board: board.trim(), keyword: keyword.trim(), scoreMode, score: score.trim() };
  }, [onScreen, boardSettled, board, keyword, score, scoreMode, keywordError, scoreError]);

  const set = (patch: Record<string, string>): void => onChange({ ...step.config, ...patch });

  // A board typed in another case takes the directory's spelling once the list has it.
  const settleBoard = (): void => {
    setBoardFocused(false);
    setBoardTouched(true);
    const match = choices.find((choice) => choice.board.toLowerCase() === typedBoard);
    if (match && match.board !== board) set({ board: match.board });
  };

  return (
    <Stack gap="xs" ref={boxRef}>
      <Autocomplete
        label={t('flow.skill.ptt_board.board')}
        placeholder={t('flow.skill.ptt_board.board.placeholder')}
        value={board}
        onChange={(value) => set({ board: value })}
        onOptionSubmit={(value) => set({ board: value })}
        onFocus={() => setBoardFocused(true)}
        onBlur={settleBoard}
        error={boardTouched && !board.trim() ? t('flow.skill.ptt_board.board.required') : undefined}
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
        description={t('flow.skill.ptt_board.keyword.hint')}
        value={keyword}
        onChange={(e) => set({ keyword: e.currentTarget.value })}
        error={keywordError ? fillTemplate(t('flow.error.pttKeywordOperator'), { keyword: keyword.trim() }) : undefined}
      />

      <SimpleGrid type="container" cols={{ base: 1, [SCORE_SIDE_BY_SIDE_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <Input.Wrapper label={t('flow.skill.ptt_board.scoreMode')} description={t('flow.skill.ptt_board.scoreMode.hint')}>
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
      </SimpleGrid>

      {fromSetting
        ? <Text fz="xs" c="var(--text-muted)" data-ptt-preview-setting="">{t('flow.skill.ptt_board.preview.setting')}</Text>
        : !previewQuery && <Text fz="xs" c="var(--text-muted)">{t('flow.skill.ptt_board.hint')}</Text>}

      <PttBoardPreview query={previewQuery} t={t} />

      <SeenRecordRow
        has={hasRecord}
        onClear={() => void clearRecord()}
        label={t('flow.skill.ptt_board.seen.kept')}
        clearLabel={t('flow.skill.seen.clear')}
        clearHint={t('flow.skill.ptt_board.seen.clearHint')}
        reseedNotice={queryOf(step.config) !== openedWith ? t('flow.skill.ptt_board.seen.reseed') : undefined}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.ptt_board.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
