import type { TransactionEntity } from '#types/models';

import { removeSuggestions } from './suggestions';

export function validForTransfer(
  fromTransaction: TransactionEntity,
  toTransaction: TransactionEntity,
) {
  if (
    // not already a transfer
    [fromTransaction, toTransaction].every(tran => tran.transfer_id == null) &&
    fromTransaction.account !== toTransaction.account && // belong to different accounts
    fromTransaction.amount + toTransaction.amount === 0 // amount must zero each other out
  ) {
    return true;
  }
  return false;
}

// The row updates that link two transactions as the two legs of a transfer.
// Like the server's clearCategory, the category is cleared only when both
// accounts are on budget or both are off budget; a transfer in or out of
// the budget keeps it.
export function getTransferLinkUpdates(
  fromTransaction: TransactionEntity,
  toTransaction: TransactionEntity,
  accounts: ReadonlyArray<{ id: string; offbudget?: boolean | 0 | 1 }>,
  payees: ReadonlyArray<{ id: string; transfer_acct?: string | null }>,
) {
  const isOffBudget = (accountId: string) =>
    Boolean(accounts.find(account => account.id === accountId)?.offbudget);
  const payeeFor = (accountId: string) =>
    payees.find(payee => payee.transfer_acct === accountId)?.id;
  const clearCategory =
    isOffBudget(fromTransaction.account) === isOffBudget(toTransaction.account);

  return [
    {
      id: fromTransaction.id,
      ...(clearCategory && { category: null }),
      payee: payeeFor(toTransaction.account),
      transfer_id: toTransaction.id,
      // A suggested transfer is moot once the rows are linked
      suggestions: removeSuggestions(fromTransaction.suggestions, ['transfer']),
    },
    {
      id: toTransaction.id,
      ...(clearCategory && { category: null }),
      payee: payeeFor(fromTransaction.account),
      transfer_id: fromTransaction.id,
      suggestions: removeSuggestions(toTransaction.suggestions, ['transfer']),
    },
  ];
}
