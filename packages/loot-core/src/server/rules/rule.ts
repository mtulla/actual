import type { TransactionForRules } from '#server/transactions/transaction-rules';
import { mergeSuggestions } from '#shared/suggestions';
// @ts-strict-ignore
import {
  addSplitTransaction,
  groupTransaction,
  recalculateSplit,
  splitTransaction,
  ungroupTransaction,
} from '#shared/transactions';
import type { RuleEntity, SplitSuggestion } from '#types/models';

import { Action, areSuggestActionsEnabled } from './action';
import { Condition } from './condition';

function execNonSplitActions(actions: Action[], transaction) {
  const update = transaction;
  actions.forEach(action => action.exec(update));
  return update;
}

function getSplitRemainder(transactions) {
  const { error } = recalculateSplit(groupTransaction(transactions));
  return error ? error.difference : 0;
}

function execSplitActions(
  actions: Action[],
  transaction,
  exec = (action: Action, t) => action.exec(t),
) {
  const splitAmountActions = actions.filter(
    action => action.op === 'set-split-amount',
  );

  // Convert the transaction to a split transaction.
  const { data } = splitTransaction(
    ungroupTransaction(transaction),
    transaction.id,
  );
  let newTransactions: TransactionForRules[] = data;

  // Add empty splits, and apply non-set-amount actions.
  // This also populates any fixed-amount splits.
  actions.forEach(action => {
    const splitTransactionIndex = (action.options?.splitIndex ?? 0) + 1;
    if (splitTransactionIndex >= newTransactions.length) {
      const { data } = addSplitTransaction(newTransactions, transaction.id);
      newTransactions = data;
    }
    // Keep parent data separate from the child fields changed by split actions.
    newTransactions[splitTransactionIndex].parent_amount = transaction.amount;
    newTransactions[splitTransactionIndex].parent_notes =
      transaction.notes ?? '';
    newTransactions[splitTransactionIndex].parent_imported_payee =
      transaction.imported_payee ?? '';
    newTransactions[splitTransactionIndex].parent_payee =
      transaction.payee ?? '';
    newTransactions[splitTransactionIndex].parent_account =
      transaction.account ?? '';
    newTransactions[splitTransactionIndex].balance = transaction.balance;
    newTransactions[splitTransactionIndex]._balanceOfPrefetched =
      transaction._balanceOfPrefetched;
    exec(action, newTransactions[splitTransactionIndex]);
  });

  // Distribute to fixed-percent splits.
  const remainingAfterFixedAmounts = getSplitRemainder(newTransactions);
  splitAmountActions
    .filter(action => action.options.method === 'fixed-percent')
    .forEach(action => {
      const splitTransactionIndex = (action.options?.splitIndex ?? 0) + 1;
      const percent = action.value / 100;
      const amount = Math.round(remainingAfterFixedAmounts * percent);
      newTransactions[splitTransactionIndex].amount = amount;
    });

  // Distribute to remainder splits.
  const remainderActions = splitAmountActions.filter(
    action => action.options.method === 'remainder',
  );
  const remainingAfterFixedPercents = getSplitRemainder(newTransactions);
  if (remainderActions.length !== 0) {
    const amountPerRemainderSplit = Math.round(
      remainingAfterFixedPercents / remainderActions.length,
    );
    let lastNonFixedTransactionIndex = -1;
    remainderActions.forEach(action => {
      const splitTransactionIndex = (action.options?.splitIndex ?? 0) + 1;
      newTransactions[splitTransactionIndex].amount = amountPerRemainderSplit;
      lastNonFixedTransactionIndex = Math.max(
        lastNonFixedTransactionIndex,
        splitTransactionIndex,
      );
    });

    // The last remainder split will be adjusted for any leftovers from rounding.
    newTransactions[lastNonFixedTransactionIndex].amount +=
      getSplitRemainder(newTransactions);
  }

  // The split index 0 (transaction index 1) is reserved for "Apply to all" actions.
  // Remove that entry from the transaction list.
  newTransactions.splice(1, 1);
  return recalculateSplit(groupTransaction(newTransactions));
}

// A split made of `suggest` actions is stored as a suggestion; the
// transaction itself stays unsplit
function suggestSplit(actions: Action[], transaction) {
  if (
    transaction.is_parent ||
    transaction.is_child ||
    !areSuggestActionsEnabled()
  ) {
    return transaction;
  }
  const split = execSplitActions(actions, { ...transaction }, (action, t) =>
    action.execAsSet(t),
  );
  if (split.error) {
    return transaction;
  }
  const value = split.subtransactions.map((child): SplitSuggestion => ({
    amount: child.amount,
    ...(child.category && { category: child.category }),
    ...(child.notes && { notes: child.notes }),
    ...(child.payee &&
      child.payee !== transaction.payee && { payee: child.payee }),
  }));
  const ruleId = actions.find(action => action.ruleId)?.ruleId;
  return {
    ...transaction,
    suggestions: mergeSuggestions(transaction.suggestions, {
      split: { value, source: 'rule', ...(ruleId && { source_id: ruleId }) },
    }),
  };
}

export function execActions(actions: Action[], transaction) {
  const parentActions = actions.filter(action => !action.options?.splitIndex);
  const childActions = actions.filter(action => action.options?.splitIndex);
  const totalSplitCount =
    actions.reduce(
      (prev, cur) => Math.max(prev, cur.options?.splitIndex ?? 0),
      0,
    ) + 1;

  const nonSplitResult = execNonSplitActions(parentActions, transaction);
  if (totalSplitCount === 1) {
    // No splits, no need to do anything else.
    return nonSplitResult;
  }

  if (nonSplitResult.is_child) {
    // Rules with splits can't be applied to child transactions.
    return nonSplitResult;
  }

  if (childActions.some(action => action.op === 'suggest')) {
    return suggestSplit(childActions, nonSplitResult);
  }
  return execSplitActions(childActions, nonSplitResult);
}

export class Rule {
  actions: Action[];
  conditions: Condition[];
  conditionsOp;
  id?: string;
  stage: 'pre' | null | 'post';

  constructor({
    id,
    stage,
    conditionsOp,
    conditions,
    actions,
  }: {
    id?: string;
    stage?: 'pre' | null | 'post';
    conditionsOp;
    conditions;
    actions;
  }) {
    this.id = id;
    this.stage = stage ?? null;
    this.conditionsOp = conditionsOp;
    this.conditions = conditions.map(
      c => new Condition(c.op, c.field, c.value, c.options),
    );
    this.actions = actions.map(a => {
      const action = new Action(a.op, a.field, a.value, a.options);
      action.ruleId = id;
      return action;
    });
  }

  evalConditions(object): boolean {
    if (this.conditions.length === 0) {
      return false;
    }

    const method = this.conditionsOp === 'or' ? 'some' : 'every';
    return this.conditions[method](condition => {
      return condition.eval(object);
    });
  }

  execActions<T>(object: T): Partial<T> {
    const result = execActions(this.actions, {
      ...object,
    });
    const changes = Object.keys(result).reduce((prev, cur) => {
      if (result[cur] !== object[cur]) {
        prev[cur] = result[cur];
      }
      return prev;
    }, {} as T);
    return changes;
  }

  exec(object) {
    if (this.evalConditions(object)) {
      return this.execActions(object);
    }
    return null;
  }

  // Apply is similar to exec but applies the changes for you
  apply(object) {
    const changes = this.exec(object);
    return Object.assign({}, object, changes);
  }

  getId(): string | undefined {
    return this.id;
  }

  serialize(): RuleEntity {
    return {
      id: this.id,
      stage: this.stage,
      conditionsOp: this.conditionsOp,
      conditions: this.conditions.map(c => c.serialize()),
      actions: this.actions.map(a => a.serialize()),
    };
  }
}
