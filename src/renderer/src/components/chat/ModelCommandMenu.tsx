import React from 'react';
import { Divider, Group, NavLink, Text } from '@mantine/core';
import { Check } from 'lucide-react';
import { startsNewStopGroup, stopKey, type ModelStop } from '../../config/modelStops';
import { ComposerSuggestList } from './ComposerSuggestList';
import styles from './ComposerSuggestList.module.css';

interface ModelCommandMenuProps {
  stops: ModelStop[];
  /** `stopKey` of the model the chat is on; that row carries the check. */
  currentKey: string | null;
  highlightedIndex: number;
  onSelect: (stop: ModelStop) => void;
  onHover: (index: number) => void;
  emptyLabel: string;
}

/** What `/model ` lists: every provider and each model it offers, as the model menu shows them. */
export const ModelCommandMenu: React.FC<ModelCommandMenuProps> = ({
  stops, currentKey, highlightedIndex, onSelect, onHover, emptyLabel,
}) => (
  <ComposerSuggestList highlightedIndex={highlightedIndex} emptyLabel={emptyLabel} isEmpty={stops.length === 0}>
    {stops.map((stop, i) => {
      const key = stopKey(stop);
      const Icon = stop.icon;
      return (
        <React.Fragment key={key}>
          {startsNewStopGroup(stops, i) && <Divider color="var(--mantine-color-default-border)" />}
          <NavLink
            data-suggest-index={i}
            className={styles.item}
            classNames={{ section: styles.section }}
            active={i === highlightedIndex}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(event) => { event.preventDefault(); onSelect(stop); }}
            leftSection={<Icon size={15} />}
            rightSection={key === currentKey
              ? <Check size={13} color="var(--mantine-color-accent)" />
              : undefined}
            label={(
              <Group gap={6} wrap="nowrap">
                <Text span fz="var(--font-size-base)" fw={600}>{stop.label}</Text>
                {stop.sub && (
                  <Text span fz="var(--font-size-sm)" className={styles.secondary}>{stop.sub.label}</Text>
                )}
              </Group>
            )}
          />
        </React.Fragment>
      );
    })}
  </ComposerSuggestList>
);
