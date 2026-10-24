import React from 'react';
import { Box, Text } from '@mantine/core';
import { SelectDropdown } from '../../components/SelectDropdown';
import type { SelectDropdownProps } from '../../components/SelectDropdown';

/**
 * Room around the label inside the select: the input's left padding (a third of its 36px
 * height), the chevron section (its full height), the border, and a little slack. The open list
 * needs about the same for its check icon and option padding, so the widest option fits there too.
 */
export const FIT_SELECT_CHROME_PX = 56;
/** A name nobody expected (an EDITOR program, say) is cut off here rather than squeezing the row's text. */
export const FIT_SELECT_MAX_PX = 340;

function optionLabels(options: SelectDropdownProps['options']): string[] {
  return options.flatMap((option) => ('group' in option ? option.items.map((item) => item.label) : [option.label]));
}

/**
 * A SelectDropdown exactly as wide as its longest option, so the chosen value is never clipped
 * and the width does not jump when the choice changes. A hidden copy of every label shares one
 * grid cell with the select and gives the cell its width; the copies take no height, are not
 * rendered visibly (so `innerText` skips them) and are hidden from screen readers.
 */
export const FitSelectDropdown: React.FC<Omit<SelectDropdownProps, 'style' | 'w'>> = (props) => (
  <Box style={{ display: 'grid', maxWidth: FIT_SELECT_MAX_PX }}>
    <SelectDropdown {...props} style={{ gridArea: '1 / 1', minWidth: 0 }} />
    {[...new Set(optionLabels(props.options))].map((label) => (
      <Text
        key={label}
        aria-hidden
        data-fit-select-sizer
        fz="var(--font-size-base)"
        style={{
          gridArea: '1 / 1',
          height: 0,
          overflow: 'hidden',
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          paddingInlineEnd: FIT_SELECT_CHROME_PX,
        }}
      >
        {label}
      </Text>
    ))}
  </Box>
);
