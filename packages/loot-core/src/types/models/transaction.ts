import type { IntegerAmount } from '#shared/util';

import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type { PayeeEntity } from './payee';
import type { ScheduleEntity } from './schedule';

export type TransactionEntity = {
  id: string;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: TransactionEntity['id'];
  account: AccountEntity['id'];
  category?: CategoryEntity['id'];
  amount: IntegerAmount;
  payee?: PayeeEntity['id'] | null;
  notes?: string;
  date: string;
  imported_id?: string;
  imported_payee?: string;
  starting_balance_flag?: boolean;
  transfer_id?: TransactionEntity['id'];
  sort_order?: number;
  cleared?: boolean;
  reconciled?: boolean;
  tombstone?: boolean;
  forceUpcoming?: boolean;
  schedule?: ScheduleEntity['id'];
  subtransactions?: TransactionEntity[];
  _unmatched?: boolean;
  _deleted?: boolean;
  error?: {
    type: 'SplitTransactionError';
    version: 1;
    difference: number;
  } | null;
  raw_synced_data?: string | undefined;
  suggestions?: TransactionSuggestions | null;
  _ruleErrors?: string[];
};

export type SuggestionSource = 'rule' | 'api';

export type TransactionSuggestion<Value> = {
  value: Value;
  source: SuggestionSource;
  // The rule id, or a free-form name of the tool that made the suggestion
  source_id?: string;
  // 0–1, stored for API consumers; not shown in the UI
  confidence?: number;
};

// Pending suggestions only: accepting or dismissing a field removes it.
// shortcut: stored as one JSON column, so concurrent edits from two devices
// are last-write-wins for the whole set (a dismissed one can come back);
// move to per-field storage if that shows up in practice.
export type TransactionSuggestions = {
  payee?: TransactionSuggestion<PayeeEntity['id']>;
  notes?: TransactionSuggestion<string>;
  category?: TransactionSuggestion<CategoryEntity['id']>;
};

export type SuggestionField = keyof TransactionSuggestions;
