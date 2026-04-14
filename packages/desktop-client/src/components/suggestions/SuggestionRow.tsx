import {
  SvgLeftArrow2,
  SvgRightArrow2,
} from '@actual-app/components/icons/v0';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  AccountEntity,
  CategoryGroupEntity,
  PayeeEntity,
  SuggestionEntity,
} from '@actual-app/core/types/models';

import { Cell, Field, Row, ROW_HEIGHT } from '#components/table';

type SuggestionRowProps = {
  suggestion: SuggestionEntity;
  parentAmount: number;
  categoryGroups: CategoryGroupEntity[];
  payees: PayeeEntity[];
  accounts: AccountEntity[];
  showAccount: boolean;
  showCleared: boolean;
  showBalance: boolean;
};

export function SuggestionRow({
  suggestion,
  parentAmount,
  categoryGroups,
  payees,
  accounts,
  showAccount,
  showCleared,
  showBalance,
}: SuggestionRowProps) {
  const fields = suggestion.suggestion;

  function resolvePayee(id: unknown): {
    name: string;
    isTransfer: boolean;
  } {
    if (typeof id !== 'string') return { name: '', isTransfer: false };
    const payee = payees.find(p => p.id === id);
    if (payee?.transfer_acct) {
      const acct = accounts.find(a => a.id === payee.transfer_acct);
      return { name: acct?.name ?? payee.name, isTransfer: true };
    }
    return { name: payee?.name ?? '', isTransfer: false };
  }

  function resolveCategoryName(id: unknown): string {
    if (typeof id !== 'string') return '';
    for (const group of categoryGroups) {
      const cat = group.categories?.find(c => c.id === id);
      if (cat) return cat.name;
    }
    return '';
  }

  const suggestionBg = `color-mix(in srgb, ${theme.buttonPrimaryBackground} 10%, ${theme.tableBackground})`;
  const cellStyle = { borderColor: 'transparent' };
  const valueStyle = { color: theme.pageTextSubdued };

  return (
    <Row
      style={{
        backgroundColor: suggestionBg,
        height: ROW_HEIGHT,
        pointerEvents: 'none',
      }}
    >
      {/* Select placeholder */}
      <Cell width={20} style={cellStyle} />
      {/* Date placeholder - matches child transaction blank area */}
      <Field
        width={110}
        style={{
          width: 110,
          backgroundColor: theme.tableRowBackgroundHover,
          border: 0,
        }}
      />
      {/* Account placeholder */}
      {showAccount && (
        <Field
          style={{
            flex: 1,
            backgroundColor: theme.tableRowBackgroundHover,
            border: 0,
          }}
        />
      )}
      {/* Payee */}
      {(() => {
        if (!('payee' in fields)) {
          return <Cell width="flex" style={cellStyle} value="" />;
        }
        const { name, isTransfer } = resolvePayee(fields.payee);
        return (
          <Cell width="flex" style={cellStyle} plain>
            <View
              style={{
                flexDirection: 'row',
                flex: 1,
                padding: '0 5px',
                alignItems: 'center',
                ...valueStyle,
              }}
            >
              {isTransfer && (
                parentAmount > 0 ? (
                  <SvgLeftArrow2
                    style={{ width: 10, height: 10, marginRight: 5 }}
                  />
                ) : (
                  <SvgRightArrow2
                    style={{ width: 10, height: 10, marginRight: 5 }}
                  />
                )
              )}
              <Text
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name}
              </Text>
            </View>
          </Cell>
        );
      })()}
      {/* Notes */}
      <Cell
        width="flex"
        style={cellStyle}
        value={'notes' in fields ? String(fields.notes) : ''}
        valueStyle={'notes' in fields ? valueStyle : undefined}
      />
      {/* Category */}
      <Cell
        width="flex"
        style={cellStyle}
        value={'category' in fields ? resolveCategoryName(fields.category) : ''}
        valueStyle={'category' in fields ? valueStyle : undefined}
      />
      {/* Debit/Payment */}
      <Cell
        width={100}
        style={cellStyle}
        value={
          'amount' in fields && Number(fields.amount) < 0
            ? String(-Number(fields.amount))
            : ''
        }
        valueStyle={valueStyle}
        textAlign="right"
      />
      {/* Credit/Deposit */}
      <Cell
        width={100}
        style={cellStyle}
        value={
          'amount' in fields && Number(fields.amount) > 0
            ? String(fields.amount)
            : ''
        }
        valueStyle={valueStyle}
        textAlign="right"
      />
      {/* Cleared */}
      {showCleared && <Cell width={38} style={cellStyle} />}
      {/* Balance */}
      {showBalance && <Cell width={103} style={cellStyle} />}
    </Row>
  );
}
