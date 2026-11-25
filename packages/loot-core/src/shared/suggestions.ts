import type {
  SplitSuggestion,
  SuggestionField,
  SuggestionSource,
  TransactionEntity,
  TransactionSuggestion,
  TransactionSuggestions,
} from '#types/models';

// Fields whose suggestion is accepted by copying the value onto the
// transaction. Split and transfer suggestions get their own accept logic.
export const SIMPLE_FIELDS = ['payee', 'notes', 'category'] as const;

const MAX_STRING_LENGTH = 1000;
const MAX_SOURCE_ID_LENGTH = 100;
const MAX_SPLIT_COUNT = 50;

// An empty set of suggestions is always stored as null, so the
// "has suggestions" filter can be a plain `IS NOT NULL`.
function normalize(
  suggestions: TransactionSuggestions,
): TransactionSuggestions | null {
  return Object.keys(suggestions).length > 0 ? suggestions : null;
}

export function mergeSuggestions(
  current: TransactionSuggestions | null | undefined,
  incoming: TransactionSuggestions | null,
): TransactionSuggestions | null {
  return normalize({ ...current, ...incoming });
}

export function removeSuggestions(
  current: TransactionSuggestions | null | undefined,
  fields?: SuggestionField[],
): TransactionSuggestions | null {
  if (!current || !fields) {
    return null;
  }
  const rest = { ...current };
  for (const field of fields) {
    delete rest[field];
  }
  return normalize(rest);
}

// Suggested fields that were empty before and get a value from `after`, as
// when a merge or a bank import fills them in. Their suggestions are moot.
export function filledSuggestionFields(
  suggestions: TransactionSuggestions | null | undefined,
  before: Partial<Record<SuggestionField, unknown>>,
  after: Partial<Record<SuggestionField, unknown>>,
): SuggestionField[] {
  return SIMPLE_FIELDS.filter(
    field => suggestions?.[field] && !before[field] && after[field],
  );
}

export function splitTotal(split: SplitSuggestion[]) {
  return split.reduce((sum, child) => sum + child.amount, 0);
}

// Turns a transaction's pending suggestions into an ordinary update:
// suggested values are written to their fields and the accepted
// suggestions are removed in the same row update. `isUsable` lets the
// caller drop suggestions whose payee or category no longer exists.
// An accepted split comes back as `subtransactions` (child data, without
// ids); a split that no longer adds up to the amount stays pending.
export function buildAcceptDiff(
  transaction: Pick<TransactionEntity, 'id' | 'suggestions' | 'is_parent'> &
    Partial<Pick<TransactionEntity, 'is_child' | 'amount'>>,
  fields?: SuggestionField[],
  isUsable: (field: SuggestionField, value: string) => boolean = () => true,
): Partial<TransactionEntity> & Pick<TransactionEntity, 'id'> {
  const suggestions = transaction.suggestions ?? {};
  const resolved: SuggestionField[] = SIMPLE_FIELDS.filter(
    field => suggestions[field] && (!fields || fields.includes(field)),
  );

  let subtransactions: SplitSuggestion[] | undefined;
  const split = suggestions.split?.value;
  if (split && (!fields || fields.includes('split'))) {
    if (transaction.is_parent || transaction.is_child) {
      // Already split, so the suggestion is moot
      resolved.push('split');
    } else if (splitTotal(split) === transaction.amount) {
      resolved.push('split');
      subtransactions = split.map(({ category, payee, ...child }) => ({
        ...child,
        ...(category && isUsable('category', category) && { category }),
        ...(payee && isUsable('payee', payee) && { payee }),
      }));
    }
  }

  const diff: Partial<TransactionEntity> & Pick<TransactionEntity, 'id'> = {
    id: transaction.id,
    suggestions: removeSuggestions(suggestions, resolved),
  };
  for (const field of SIMPLE_FIELDS) {
    const value = suggestions[field]?.value;
    // A split parent never has its own category, so it is dropped unused
    const isParentCategory =
      field === 'category' && (transaction.is_parent || !!subtransactions);
    if (
      resolved.includes(field) &&
      value != null &&
      !isParentCategory &&
      isUsable(field, value)
    ) {
      diff[field] = value;
    }
  }
  if (subtransactions) {
    // Partial rows: makeChild fills in the rest when the split is created
    diff.subtransactions = subtransactions as TransactionEntity[];
  }
  return diff;
}

function fail(message: string): never {
  throw new Error(`Invalid suggestion: ${message}`);
}

function validateEntry(
  field: string,
  entry: unknown,
  sourceOverride?: SuggestionSource,
): TransactionSuggestion<string> {
  if (entry == null || typeof entry !== 'object') {
    fail(`"${field}" must be an object`);
  }
  const { value, source_id, confidence, ...rest } = entry as Record<
    string,
    unknown
  >;
  const source = sourceOverride ?? rest.source;
  if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH) {
    fail(`"${field}.value" must be a string under ${MAX_STRING_LENGTH} chars`);
  }
  if (source !== 'rule' && source !== 'api') {
    fail(`"${field}.source" must be "rule" or "api"`);
  }
  if (
    source_id != null &&
    (typeof source_id !== 'string' || source_id.length > MAX_SOURCE_ID_LENGTH)
  ) {
    fail(`"${field}.source_id" must be a short string`);
  }
  if (
    confidence != null &&
    (typeof confidence !== 'number' || confidence < 0 || confidence > 1)
  ) {
    fail(`"${field}.confidence" must be a number between 0 and 1`);
  }
  return {
    value,
    source,
    ...(typeof source_id === 'string' && { source_id }),
    ...(typeof confidence === 'number' && { confidence }),
  };
}

function validateSplitEntry(
  entry: unknown,
  sourceOverride?: SuggestionSource,
): TransactionSuggestion<SplitSuggestion[]> {
  if (entry == null || typeof entry !== 'object') {
    fail('"split" must be an object');
  }
  const { value } = entry as Record<string, unknown>;
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_SPLIT_COUNT
  ) {
    fail(`"split.value" must be a list of 2 to ${MAX_SPLIT_COUNT} splits`);
  }
  const children = value.map((child, i): SplitSuggestion => {
    if (child == null || typeof child !== 'object') {
      fail(`"split.value[${i}]" must be an object`);
    }
    const { amount, category, notes, payee } = child as Record<string, unknown>;
    if (!Number.isInteger(amount)) {
      fail(`"split.value[${i}].amount" must be an integer amount`);
    }
    for (const [name, text] of Object.entries({ category, notes, payee })) {
      if (
        text != null &&
        (typeof text !== 'string' || text.length > MAX_STRING_LENGTH)
      ) {
        fail(`"split.value[${i}].${name}" must be a string`);
      }
    }
    return {
      amount: amount as number,
      ...(typeof category === 'string' && { category }),
      ...(typeof notes === 'string' && { notes }),
      ...(typeof payee === 'string' && { payee }),
    };
  });
  // The rest of the entry has the same shape as any other suggestion
  return {
    ...validateEntry('split', { ...entry, value: '' }, sourceOverride),
    value: children,
  };
}

// Checks the shape of untrusted suggestions (e.g. from the API). It does not
// check that referenced payees and categories exist; that needs the database.
export function validateSuggestions(
  input: unknown,
  { source }: { source?: SuggestionSource } = {},
): TransactionSuggestions | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    fail('suggestions must be an object');
  }
  const result: TransactionSuggestions = {};
  for (const [field, entry] of Object.entries(input)) {
    if (field === 'split') {
      result.split = validateSplitEntry(entry, source);
    } else if (
      field === 'transfer' ||
      (SIMPLE_FIELDS as readonly string[]).includes(field)
    ) {
      result[field as (typeof SIMPLE_FIELDS)[number] | 'transfer'] =
        validateEntry(field, entry, source);
    } else {
      fail(`unsupported field "${field}"`);
    }
  }
  return normalize(result);
}
