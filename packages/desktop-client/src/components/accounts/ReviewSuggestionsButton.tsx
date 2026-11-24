import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { q } from '@actual-app/core/shared/query';
import type { RuleConditionEntity } from '@actual-app/core/types/models';

import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useQuery } from '#hooks/useQuery';
import { accountFilter } from '#queries';

type ReviewSuggestionsButtonProps = {
  accountId?: Parameters<typeof accountFilter>[0];
  // Hidden reconciled rows can't be reviewed, so they aren't counted
  showReconciled: boolean;
  onApplyFilter: (filter: RuleConditionEntity) => void;
};

export function ReviewSuggestionsButton({
  accountId,
  showReconciled,
  onApplyFilter,
}: ReviewSuggestionsButtonProps) {
  const isEnabled = useFeatureFlag('transactionSuggestions');
  const { data } = useQuery<{ count: number }>(
    () =>
      isEnabled
        ? q('transactions')
            .filter({
              ...accountFilter(accountId),
              suggestions: { $ne: null },
              ...(!showReconciled && { reconciled: false }),
            })
            .options({ splits: 'all' })
            .select({ count: { $count: '$id' } })
        : null,
    [isEnabled, accountId, showReconciled],
  );
  const count = data?.[0]?.count ?? 0;

  if (count === 0) {
    return null;
  }

  return (
    <Button
      variant="bare"
      onPress={() =>
        onApplyFilter({ field: 'has_suggestions', op: 'is', value: true })
      }
    >
      <Trans count={count}>Review suggestions · {{ count }}</Trans>
    </Button>
  );
}
