import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgCheckmark, SvgClose } from '@actual-app/components/icons/v1';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type SuggestionActionsProps = {
  // Names the row for screen readers, which list every row's buttons
  payee?: string;
  onAccept: () => void;
  onDismiss: () => void;
};

export function SuggestionActions({
  payee,
  onAccept,
  onDismiss,
}: SuggestionActionsProps) {
  const { t } = useTranslation();

  return (
    <View
      style={{ flexDirection: 'row', flexShrink: 0, gap: 2, marginLeft: 4 }}
      // Keep clicks on the buttons from opening the cell editor
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      <Button
        variant="bare"
        aria-label={
          payee
            ? t('Accept suggestions for {{payee}}', { payee })
            : t('Accept suggestions')
        }
        style={{ padding: 4, color: theme.noticeText }}
        onPress={onAccept}
      >
        <SvgCheckmark style={{ width: 10, height: 10 }} />
      </Button>
      <Button
        variant="bare"
        aria-label={
          payee
            ? t('Dismiss suggestions for {{payee}}', { payee })
            : t('Dismiss suggestions')
        }
        style={{ padding: 4, color: theme.pageTextLight }}
        onPress={onDismiss}
      >
        <SvgClose style={{ width: 9, height: 9 }} />
      </Button>
    </View>
  );
}
