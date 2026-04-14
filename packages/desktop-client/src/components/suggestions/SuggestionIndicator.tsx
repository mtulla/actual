import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  CategoryGroupEntity,
  PayeeEntity,
  SuggestionEntity,
} from '@actual-app/core/types/models';

type SuggestionFooterProps = {
  suggestions: SuggestionEntity[];
  categoryGroups: CategoryGroupEntity[];
  payees: PayeeEntity[];
  onAccept: (suggestion: SuggestionEntity) => void;
  onDismiss: (suggestion: SuggestionEntity) => void;
};

export function SuggestionFooter({
  suggestions,
  categoryGroups,
  payees,
  onAccept,
  onDismiss,
}: SuggestionFooterProps) {
  if (suggestions.length === 0) {
    return null;
  }

  function formatFieldValue(field: string, value: unknown): string {
    if (field === 'category' && typeof value === 'string') {
      for (const group of categoryGroups) {
        const cat = group.categories?.find(c => c.id === value);
        if (cat) return cat.name;
      }
      return String(value);
    }
    if (field === 'payee' && typeof value === 'string') {
      const payee = payees.find(p => p.id === value);
      return payee?.name ?? String(value);
    }
    return String(value);
  }

  const suggestion = suggestions[0];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: '0 5px',
      }}
    >
      {Object.entries(suggestion.suggestion).map(([field, value]) => (
        <Text key={field} style={{ fontSize: 12 }}>
          <Text style={{ color: theme.pageTextSubdued }}>{field}: </Text>
          <Text style={{ fontWeight: 500 }}>
            {formatFieldValue(field, value)}
          </Text>
        </Text>
      ))}

      {suggestion.source && (
        <Text
          style={{
            fontSize: 11,
            color: theme.pageTextSubdued,
            fontStyle: 'italic',
            marginLeft: 8,
          }}
        >
          ({suggestion.source})
        </Text>
      )}

      <View style={{ flex: 1 }} />

      <Button
        variant="bare"
        style={{ marginLeft: 10, color: theme.pageTextSubdued }}
        onPress={() => onDismiss(suggestion)}
      >
        <Trans>Dismiss</Trans>
      </Button>
      <Button
        variant="primary"
        style={{ marginLeft: 10, padding: '4px 10px' }}
        onPress={() => onAccept(suggestion)}
      >
        <Trans>Accept Suggestion</Trans>
      </Button>
    </View>
  );
}
