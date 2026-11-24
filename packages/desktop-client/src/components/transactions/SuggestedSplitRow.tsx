import type { CSSProperties } from 'react';

import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { isPreviewId } from '@actual-app/core/shared/transactions';
import { integerToCurrency } from '@actual-app/core/shared/util';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { Cell, Field, Row } from '#components/table';

import { isTransactionTableColumnAvailableInChildRows } from './table/columns';
import type { TransactionTableColumnId } from './table/columns';

const ID_PREFIX = 'suggested-split/';

export function isSuggestedSplitId(id: string) {
  return id.startsWith(ID_PREFIX);
}

// Adds a read-only row under each unsplit transaction for every part of its
// suggested split, so the split can be reviewed before it is accepted
export function withSuggestedSplitRows(transactions: TransactionEntity[]) {
  return transactions.flatMap(transaction => {
    const split =
      transaction.is_parent || isPreviewId(transaction.id)
        ? undefined
        : transaction.suggestions?.split?.value;
    if (!split) {
      return [transaction];
    }
    return [
      transaction,
      ...split.map((child, index): TransactionEntity => ({
        id: `${ID_PREFIX}${transaction.id}/${index}`,
        account: transaction.account,
        date: transaction.date,
        amount: child.amount,
        // Parts without their own payee or category get the row's, as they
        // do when the split is accepted
        payee: child.payee ?? transaction.payee,
        category: child.category ?? transaction.category,
        notes: child.notes,
        reconciled: transaction.reconciled,
        sort_order: transaction.sort_order,
      })),
    ];
  });
}

type SuggestedSplitRowProps = {
  columns: TransactionTableColumnId[];
  amountColumnWidths: { amount: number; balance: number };
  amount: number;
  payeeName?: string;
  categoryName?: string;
  notes?: string;
};

export function SuggestedSplitRow({
  columns,
  amountColumnWidths,
  amount,
  payeeName,
  categoryName,
  notes,
}: SuggestedSplitRowProps) {
  const cellStyle: CSSProperties = { borderBottomStyle: 'dashed' };
  const suggestedStyle = {
    fontStyle: 'italic',
    color: theme.pageTextPositive,
  };
  const blankStyle = {
    backgroundColor: theme.tableRowBackgroundHover,
    border: 0,
  };

  const renderCell = (columnId: TransactionTableColumnId) => {
    switch (columnId) {
      case 'date':
        return <Field key={columnId} width={110} style={blankStyle} />;
      case 'account':
        return <Field key={columnId} style={{ flex: 1, ...blankStyle }} />;
      case 'payee':
        return (
          <Cell
            key={columnId}
            width="flex"
            value={payeeName}
            style={cellStyle}
            valueStyle={{ color: theme.pageTextSubdued }}
          />
        );
      case 'notes':
        return (
          <Cell
            key={columnId}
            width="flex"
            value={notes}
            style={cellStyle}
            valueStyle={suggestedStyle}
          />
        );
      case 'category':
        return (
          <Cell
            key={columnId}
            width="flex"
            value={categoryName}
            style={cellStyle}
            valueStyle={suggestedStyle}
          />
        );
      case 'group':
        return <Cell key={columnId} width="flex" style={cellStyle} />;
      case 'payment':
      case 'deposit': {
        const isShown = columnId === 'payment' ? amount <= 0 : amount > 0;
        return (
          <Cell
            key={columnId}
            width={amountColumnWidths.amount}
            textAlign="right"
            value={isShown ? integerToCurrency(Math.abs(amount)) : ''}
            style={{ ...cellStyle, ...styles.tnum }}
            privacyFilter
            valueStyle={suggestedStyle}
          />
        );
      }
      case 'balance':
        return (
          <Cell
            key={columnId}
            width={amountColumnWidths.balance}
            style={cellStyle}
          />
        );
      case 'cleared':
        return <Cell key={columnId} width={38} style={cellStyle} />;
      default:
        return null;
    }
  };

  // Lines up with child rows, which put the selection cell before the first
  // column a child shows
  const firstChildColumn = columns.findIndex(
    isTransactionTableColumnAvailableInChildRows,
  );
  const selectionIndex =
    firstChildColumn === -1 ? columns.length : firstChildColumn;

  return (
    <Row style={{ backgroundColor: theme.tableBackground }}>
      {columns.slice(0, selectionIndex).map(renderCell)}
      <Cell width={20} style={cellStyle} />
      {columns.slice(selectionIndex).map(renderCell)}
      <Cell width={5} style={cellStyle} />
    </Row>
  );
}
