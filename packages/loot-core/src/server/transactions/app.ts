import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';
import { q, Query } from '#shared/query';
import type { QueryState } from '#shared/query';
import { buildAcceptDiff, removeSuggestions } from '#shared/suggestions';
import type {
  AccountEntity,
  CategoryGroupEntity,
  PayeeEntity,
  SuggestionField,
  TransactionEntity,
} from '#types/models';

import { exportQueryToCSV, exportToCSV } from './export/export-to-csv';
import { parseFile } from './import/parse-file';
import type { ParseFileOptions } from './import/parse-file';
import { mergeTransactions } from './merge';

import { batchUpdateTransactions } from '.';

export type TransactionHandlers = {
  'transactions-batch-update': typeof handleBatchUpdateTransactions;
  'transaction-add': typeof addTransaction;
  'transaction-update': typeof updateTransaction;
  'transaction-delete': typeof deleteTransaction;
  'transaction-move': typeof moveTransaction;
  'transactions-parse-file': typeof parseTransactionsFile;
  'transactions-export': typeof exportTransactions;
  'transactions-export-query': typeof exportTransactionsQuery;
  'transactions-merge': typeof mergeTransactions;
  'transactions-accept-suggestions': typeof acceptSuggestions;
  'transactions-dismiss-suggestions': typeof dismissSuggestions;
  'get-earliest-transaction': typeof getEarliestTransaction;
  'get-latest-transaction': typeof getLatestTransaction;
};

async function handleBatchUpdateTransactions({
  added,
  deleted,
  updated,
  learnCategories,
  runTransfers = true,
}: Parameters<typeof batchUpdateTransactions>[0]) {
  const result = await batchUpdateTransactions({
    added,
    updated,
    deleted,
    learnCategories,
    runTransfers,
  });

  return result;
}

async function getTransactionsWithSuggestions(
  ids: TransactionEntity['id'][],
): Promise<TransactionEntity[]> {
  const { data } = await aqlQuery(
    q('transactions')
      .filter({ id: { $oneof: ids }, suggestions: { $ne: null } })
      .select('*')
      .options({ splits: 'all' }),
  );
  return data;
}

type SuggestionsArgs = {
  ids: TransactionEntity['id'][];
  // All pending suggestions when omitted
  fields?: SuggestionField[];
};

// Ids of the payees and categories that still exist, so accepting never
// writes a deleted one onto a transaction.
async function getLiveIds(transactions: TransactionEntity[]) {
  // Deduped: a big selection mostly suggests the same few payees and
  // categories, and SQLite limits the number of bound parameters
  const values = [
    ...new Set(
      transactions.flatMap(t =>
        [t.suggestions?.payee?.value, t.suggestions?.category?.value].filter(
          (v): v is string => v != null,
        ),
      ),
    ),
  ];
  if (values.length === 0) {
    return new Set<string>();
  }
  // Bound parameters: suggestion values can come from the API
  const marks = values.map(() => '?').join(',');
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM payees WHERE tombstone = 0 AND id IN (${marks})
     UNION SELECT id FROM categories WHERE tombstone = 0 AND id IN (${marks})`,
    [...values, ...values],
  );
  return new Set(rows.map(row => row.id));
}

async function acceptSuggestions({
  ids,
  fields,
  allowReconciled = false,
}: SuggestionsArgs & {
  allowReconciled?: boolean;
}): Promise<
  | { status: 'ok'; ids: TransactionEntity['id'][] }
  | { status: 'needs-confirmation'; reconciledIds: TransactionEntity['id'][] }
> {
  const transactions = await getTransactionsWithSuggestions(ids);

  // A new payee on a transfer also rewrites the other leg, so a reconciled
  // other leg needs confirmation too
  const transferIds = transactions
    .filter(t => t.transfer_id && t.suggestions?.payee)
    .map(t => t.transfer_id);
  const { data: reconciledLegs } = transferIds.length
    ? await aqlQuery(
        q('transactions')
          .filter({ id: { $oneof: transferIds }, reconciled: true })
          .select('id'),
      )
    : { data: [] };
  const reconciledLegIds = new Set(
    (reconciledLegs as Pick<TransactionEntity, 'id'>[]).map(t => t.id),
  );
  const reconciledIds = transactions
    .filter(
      t =>
        t.reconciled || (t.transfer_id && reconciledLegIds.has(t.transfer_id)),
    )
    .map(t => t.id);
  if (reconciledIds.length > 0 && !allowReconciled) {
    return { status: 'needs-confirmation', reconciledIds };
  }

  // One row update per transaction writes the values and clears the
  // suggestions together, so undo, sync and transfers behave like a manual
  // edit. Deliberately not wrapped in another batchMessages: inside one,
  // batchUpdateTransactions would read the rows from before this change.
  const liveIds = await getLiveIds(transactions);
  const updated = transactions.map(t =>
    buildAcceptDiff(
      t,
      fields,
      (field, value) => field === 'notes' || liveIds.has(value),
    ),
  );
  if (updated.length > 0) {
    await batchUpdateTransactions({ updated });
  }
  return { status: 'ok', ids: updated.map(u => u.id) };
}

async function dismissSuggestions({ ids, fields }: SuggestionsArgs) {
  const transactions = await getTransactionsWithSuggestions(ids);
  const updated = transactions.map(t => ({
    id: t.id,
    suggestions: removeSuggestions(t.suggestions, fields),
  }));
  if (updated.length > 0) {
    await batchUpdateTransactions({ updated });
  }
  return { ids: updated.map(u => u.id) };
}

async function addTransaction(transaction: TransactionEntity) {
  await handleBatchUpdateTransactions({ added: [transaction] });
  return {};
}

async function updateTransaction(transaction: TransactionEntity) {
  await handleBatchUpdateTransactions({ updated: [transaction] });
  return {};
}

async function deleteTransaction(transaction: Pick<TransactionEntity, 'id'>) {
  await handleBatchUpdateTransactions({ deleted: [transaction] });
  return {};
}

async function moveTransaction({
  id,
  accountId,
  targetId,
}: {
  id: string;
  accountId: string;
  targetId: string | null;
}) {
  // Fetch the transaction to validate it exists and verify account
  const transaction = await db.getTransaction(id);
  if (!transaction) {
    throw new Error(`Transaction not found: ${id}`);
  }

  // Validate that the provided accountId matches the transaction's actual account
  // This prevents sort order calculations against the wrong account
  if (transaction.account !== accountId) {
    throw new Error(
      `Account mismatch: transaction belongs to account ${transaction.account}, not ${accountId}`,
    );
  }

  // Child transactions can be reordered within their parent's children
  // The db.moveTransaction handles the sibling-scoped reordering for children

  await db.moveTransaction(id, accountId, targetId);
  return {};
}

async function parseTransactionsFile({
  filepath,
  options,
}: {
  filepath: string;
  options: ParseFileOptions;
}) {
  return parseFile(filepath, options);
}

async function exportTransactions({
  transactions,
  accounts,
  categoryGroups,
  payees,
}: {
  transactions: TransactionEntity[];
  accounts: AccountEntity[];
  categoryGroups: CategoryGroupEntity[];
  payees: PayeeEntity[];
}) {
  return exportToCSV(transactions, accounts, categoryGroups, payees);
}

async function exportTransactionsQuery({
  query: queryState,
}: {
  query: QueryState;
}) {
  return exportQueryToCSV(new Query(queryState));
}

async function getEarliestTransaction() {
  const { data } = await aqlQuery(
    q('transactions')
      .options({ splits: 'none' })
      .orderBy({ date: 'asc' })
      .select('*')
      .limit(1),
  );
  return data[0] || null;
}

async function getLatestTransaction() {
  const { data } = await aqlQuery(
    q('transactions')
      .options({ splits: 'none' })
      .orderBy({ date: 'desc' })
      .select('*')
      .limit(1),
  );
  return data[0] || null;
}

export const app = createApp<TransactionHandlers>();

app.method(
  'transactions-batch-update',
  mutator(undoable(handleBatchUpdateTransactions)),
);
app.method('transactions-merge', mutator(undoable(mergeTransactions)));
app.method(
  'transactions-accept-suggestions',
  mutator(undoable(acceptSuggestions)),
);
app.method(
  'transactions-dismiss-suggestions',
  mutator(undoable(dismissSuggestions)),
);

app.method('transaction-add', mutator(addTransaction));
app.method('transaction-update', mutator(updateTransaction));
app.method('transaction-delete', mutator(deleteTransaction));
app.method('transaction-move', mutator(undoable(moveTransaction)));
app.method('transactions-parse-file', mutator(parseTransactionsFile));
app.method('transactions-export', mutator(exportTransactions));
app.method('transactions-export-query', mutator(exportTransactionsQuery));
app.method('get-earliest-transaction', getEarliestTransaction);
app.method('get-latest-transaction', getLatestTransaction);
