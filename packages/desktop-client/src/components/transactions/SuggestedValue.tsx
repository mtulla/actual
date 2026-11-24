import type { ReactNode } from 'react';

import { theme } from '@actual-app/components/theme';

type SuggestedValueProps = {
  // What the field holds now; shown struck through. Empty when unset.
  current?: ReactNode;
  suggested: string;
};

export function SuggestedValue({ current, suggested }: SuggestedValueProps) {
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {current ? (
        <span
          style={{
            // The current value gives way first in a narrow column
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textDecoration: 'line-through',
            color: theme.pageTextLight,
          }}
        >
          {current}
        </span>
      ) : null}
      <span
        style={{
          flexShrink: 0,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontStyle: 'italic',
          color: theme.pageTextPositive,
        }}
      >
        {suggested}
      </span>
    </span>
  );
}
