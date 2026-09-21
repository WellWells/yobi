import React, { useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Text, UnstyledButton } from '@mantine/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LAST_DAY_OF_MONTH, daysInMonth, toIsoDate, weekdayLabel } from '../../../../shared/flowSchedule';
import classes from './DateGrid.module.css';

interface CellProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  today?: boolean;
  wide?: boolean;
}

const Cell: React.FC<CellProps> = ({ label, selected, onClick, disabled, today, wide }) => (
  <UnstyledButton
    className={wide ? `${classes.cell} ${classes.wide}` : classes.cell}
    data-selected={selected ? 'true' : undefined}
    data-today={today ? 'true' : undefined}
    disabled={disabled}
    aria-pressed={selected}
    onClick={onClick}
  >
    {label}
  </UnstyledButton>
);

interface MonthDayGridProps {
  selected: number[];
  onToggle: (day: number) => void;
  t: (key: string) => string;
  /** Yearly clamps to the chosen month's length; monthly always shows all 31. */
  maxDay?: number;
  showLastDay?: boolean;
}

/**
 * Deliberately NOT weekday-aligned. A real calendar has to pick a reference month to lay out, which
 * would imply that "the 15th" lands on the same weekday every month. The grid is 7 wide because
 * that reads as a calendar, not because the columns mean weekdays.
 */
export const MonthDayGrid: React.FC<MonthDayGridProps> = ({
  selected, onToggle, t, maxDay = 31, showLastDay = false,
}) => {
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);
  return (
    <Box className={classes.grid} style={{ gridTemplateColumns: 'repeat(7, 1fr)' }} role="group">
      {days.map((day) => (
        <Cell
          key={day}
          label={String(day)}
          selected={selected.includes(day)}
          onClick={() => onToggle(day)}
        />
      ))}
      {showLastDay && (
        <Cell
          wide
          label={t('flow.trigger.schedule.lastDay')}
          selected={selected.includes(LAST_DAY_OF_MONTH)}
          onClick={() => onToggle(LAST_DAY_OF_MONTH)}
        />
      )}
    </Box>
  );
};

interface MonthGridProps {
  value: number;
  onChange: (month: number) => void;
  t: (key: string) => string;
}

export const MonthGrid: React.FC<MonthGridProps> = ({ value, onChange, t }) => (
  <Box className={classes.grid} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }} role="group">
    {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
      <Cell
        key={month}
        label={t(`flow.trigger.schedule.month.${month}`)}
        selected={value === month}
        onClick={() => onChange(month)}
      />
    ))}
  </Box>
);

interface CalendarGridProps {
  value: string;
  onChange: (isoDate: string) => void;
  t: (key: string) => string;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The only weekday-aligned grid here: picking one specific date is the case where weekday matters. */
export const CalendarGrid: React.FC<CalendarGridProps> = ({ value, onChange, t }) => {
  const selectedDate = useMemo(() => {
    const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return parsed ? new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])) : new Date();
  }, [value]);
  const [view, setView] = useState(() => ({
    year: selectedDate.getFullYear(),
    month: selectedDate.getMonth() + 1,
  }));

  const today = startOfDay(new Date());
  const total = daysInMonth(view.month, view.year);
  const leading = new Date(view.year, view.month - 1, 1).getDay();

  const shift = (delta: number): void => {
    setView((prev) => {
      const next = new Date(prev.year, prev.month - 1 + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() + 1 };
    });
  };

  return (
    <Box>
      <Group justify="space-between" align="center" mb={6} wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={t('flow.trigger.schedule.previousMonth')}
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={15} />
        </ActionIcon>
        <Text fz="sm" fw={600}>
          {`${view.year} ${t(`flow.trigger.schedule.month.${view.month}`)}`}
        </Text>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={t('flow.trigger.schedule.nextMonth')}
          onClick={() => shift(1)}
        >
          <ChevronRight size={15} />
        </ActionIcon>
      </Group>

      <Box className={classes.header} aria-hidden="true">
        {Array.from({ length: 7 }, (_, day) => (
          <Text key={day} className={classes.headerCell}>{weekdayLabel(t, day)}</Text>
        ))}
      </Box>

      <Box className={classes.grid} style={{ gridTemplateColumns: 'repeat(7, 1fr)' }} role="group">
        {Array.from({ length: leading }, (_, i) => <Box key={`pad-${i}`} />)}
        {Array.from({ length: total }, (_, i) => i + 1).map((day) => {
          const date = new Date(view.year, view.month - 1, day);
          const iso = toIsoDate(date);
          return (
            <Cell
              key={day}
              label={String(day)}
              selected={iso === value}
              today={date.getTime() === today.getTime()}
              disabled={date.getTime() < today.getTime()}
              onClick={() => onChange(iso)}
            />
          );
        })}
      </Box>
    </Box>
  );
};
