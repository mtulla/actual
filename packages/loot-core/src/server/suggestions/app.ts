import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { batchMessages } from '#server/sync';
import { batchUpdateTransactions } from '#server/transactions';
import type { SuggestionEntity } from '#types/models';

export type SuggestionsHandlers = {
  'suggestions-get': typeof getSuggestions;
  'suggestions-get-by-transaction': typeof getSuggestionsByTransaction;
  'suggestion-create': typeof createSuggestion;
  'suggestion-accept': typeof acceptSuggestion;
  'suggestion-dismiss': typeof dismissSuggestion;
  'suggestions-dismiss-all': typeof dismissAllSuggestions;
};

export const app = createApp<SuggestionsHandlers>();
app.method('suggestions-get', getSuggestions);
app.method('suggestions-get-by-transaction', getSuggestionsByTransaction);
app.method('suggestion-create', mutator(createSuggestion));
app.method('suggestion-accept', mutator(acceptSuggestion));
app.method('suggestion-dismiss', mutator(dismissSuggestion));
app.method('suggestions-dismiss-all', mutator(dismissAllSuggestions));

function toEntity(row: db.DbSuggestion): SuggestionEntity {
  return {
    id: row.id,
    transaction_id: row.transaction_id,
    suggestion: JSON.parse(row.suggestion),
    source: row.source,
    source_id: row.source_id,
    confidence: row.confidence,
    group_id: row.group_id,
    status: row.status,
    created_at: row.created_at,
  };
}

async function getSuggestions(): Promise<SuggestionEntity[]> {
  const rows = await db.getAllPendingSuggestions();
  return rows.map(toEntity);
}

async function getSuggestionsByTransaction(
  transactionId: string,
): Promise<SuggestionEntity[]> {
  const rows = await db.getSuggestions(transactionId);
  return rows.map(toEntity);
}

async function createSuggestion({
  transaction_id,
  suggestion,
  source,
  source_id = null,
  confidence = null,
  group_id = null,
}: Omit<
  SuggestionEntity,
  'id' | 'status' | 'created_at'
>): Promise<SuggestionEntity> {
  const created_at = new Date().toISOString();
  const id = await db.insertSuggestion({
    transaction_id,
    suggestion: JSON.stringify(suggestion),
    source,
    source_id,
    confidence,
    group_id,
    status: 'pending',
    created_at,
  });
  return {
    id,
    transaction_id,
    suggestion,
    source,
    source_id,
    confidence,
    group_id,
    status: 'pending',
    created_at,
  };
}

async function acceptSuggestion({
  id,
}: Pick<SuggestionEntity, 'id'>): Promise<void> {
  const row = await db.getSuggestionById(id);
  if (!row) {
    throw new Error(`Suggestion not found: ${id}`);
  }

  const fields = JSON.parse(row.suggestion);

  // Use batchUpdateTransactions which properly handles
  // category_mapping, transfers, and other side effects
  await batchUpdateTransactions({
    updated: [{ id: row.transaction_id, ...fields }],
  });

  // Mark suggestion as accepted
  await db.updateSuggestion({ id, status: 'accepted' });
}

async function dismissSuggestion({
  id,
}: Pick<SuggestionEntity, 'id'>): Promise<void> {
  await db.updateSuggestion({ id, status: 'dismissed' });
}

async function dismissAllSuggestions(transactionId: string): Promise<void> {
  const rows = await db.getSuggestions(transactionId);
  await batchMessages(async () => {
    for (const row of rows) {
      await db.updateSuggestion({ id: row.id, status: 'dismissed' });
    }
  });
}
