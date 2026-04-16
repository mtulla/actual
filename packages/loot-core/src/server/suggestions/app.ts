import * as asyncStorage from '#platform/server/asyncStorage';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { post } from '#server/post';
import { getServer } from '#server/server-config';
import { batchMessages } from '#server/sync';
import { batchUpdateTransactions } from '#server/transactions';
import type { SuggestionEntity } from '#types/models';

export type SuggestionsHandlers = {
  'suggestions-get': typeof getSuggestions;
  'suggestions-get-by-transaction': typeof getSuggestionsByTransaction;
  'suggestions-get-new': typeof getNewTransactionSuggestions;
  'suggestion-create': typeof createSuggestion;
  'suggestion-accept': typeof acceptSuggestion;
  'suggestion-dismiss': typeof dismissSuggestion;
  'suggestions-dismiss-all': typeof dismissAllSuggestions;
};

export const app = createApp<SuggestionsHandlers>();
app.method('suggestions-get', getSuggestions);
app.method('suggestions-get-by-transaction', getSuggestionsByTransaction);
app.method('suggestions-get-new', getNewTransactionSuggestions);
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

/**
 * Fire-and-forget POST to the sync server's /suggestions/outcome endpoint
 * for Datadog LLM Observability. Silently ignored if no server is configured.
 */
async function notifySuggestionOutcome(
  row: db.DbSuggestion,
  outcome: 'accepted' | 'dismissed',
) {
  try {
    const server = getServer();
    if (!server) {
      console.log('notifySuggestionOutcome: no server configured, skipping');
      return;
    }

    const userToken = await asyncStorage.getItem('user-token');
    console.log(
      `notifySuggestionOutcome: POST ${server.BASE_SERVER}/suggestions/outcome`,
      { suggestion_id: row.id, outcome, hasToken: !!userToken },
    );
    await post(
      server.BASE_SERVER + '/suggestions/outcome',
      {
        suggestion_id: row.id,
        transaction_id: row.transaction_id ?? null,
        suggestion: JSON.parse(row.suggestion),
        transaction_before: row.transaction_id
          ? await getTransactionSnapshot(row.transaction_id)
          : null,
        outcome,
      },
      {
        'X-ACTUAL-TOKEN': userToken,
      },
    );
    console.log('notifySuggestionOutcome: success');
  } catch (err) {
    console.error('notifySuggestionOutcome: failed', err);
  }
}

async function getTransactionSnapshot(
  transactionId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const row = await db.first<Record<string, unknown>>(
      'SELECT * FROM v_transactions_internal WHERE id = ?',
      [transactionId],
    );
    return row ?? null;
  } catch {
    return null;
  }
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

async function getNewTransactionSuggestions({
  accountId,
}: {
  accountId?: string;
}): Promise<SuggestionEntity[]> {
  const rows = accountId
    ? await db.getNewTransactionSuggestions(accountId)
    : await db.getAllNewTransactionSuggestions();
  return rows.map(toEntity);
}

async function createSuggestion({
  transaction_id = null,
  suggestion,
  source,
  source_id = null,
  confidence = null,
  group_id = null,
}: Omit<
  SuggestionEntity,
  'id' | 'status' | 'created_at'
>): Promise<SuggestionEntity> {
  // Validate new-transaction suggestions have required fields
  if (!transaction_id) {
    if (!suggestion.account || !suggestion.date || suggestion.amount == null) {
      throw new Error(
        'New-transaction suggestions must include account, date, and amount',
      );
    }
  }

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

  if (row.transaction_id) {
    await batchUpdateTransactions({
      updated: [{ id: row.transaction_id, ...fields }],
    });
  } else {
    await batchUpdateTransactions({
      added: [fields],
    });
  }

  await db.updateSuggestion({ id, status: 'accepted' });

  // Notify sync server for observability (fire-and-forget)
  void notifySuggestionOutcome(row, 'accepted');
}

async function dismissSuggestion({
  id,
}: Pick<SuggestionEntity, 'id'>): Promise<void> {
  const row = await db.getSuggestionById(id);
  if (!row) {
    throw new Error(`Suggestion not found: ${id}`);
  }

  await db.updateSuggestion({ id, status: 'dismissed' });

  // Notify sync server for observability (fire-and-forget)
  void notifySuggestionOutcome(row, 'dismissed');
}

async function dismissAllSuggestions(transactionId: string): Promise<void> {
  const rows = await db.getSuggestions(transactionId);
  await batchMessages(async () => {
    for (const row of rows) {
      await db.updateSuggestion({ id: row.id, status: 'dismissed' });
      void notifySuggestionOutcome(row, 'dismissed');
    }
  });
}
