import type {
  SuggestionField,
  SuggestionSource,
  TransactionEntity,
  TransactionSuggestion,
  TransactionSuggestions,
} from '#types/models';

// Fields whose suggestion is accepted by copying the value onto the
// transaction. Split and transfer suggestions get their own accept logic.
const SIMPLE_FIELDS = ['payee', 'notes', 'category'] as const;

const MAX_STRING_LENGTH = 1000;
const MAX_SOURCE_ID_LENGTH = 100;

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

// Turns a transaction's pending suggestions into an ordinary update:
// suggested values are written to their fields and the accepted
// suggestions are removed in the same row update. `isUsable` lets the
// caller drop suggestions whose payee or category no longer exists.
export function buildAcceptDiff(
  transaction: Pick<TransactionEntity, 'id' | 'suggestions' | 'is_parent'>,
  fields?: SuggestionField[],
  isUsable: (field: SuggestionField, value: string) => boolean = () => true,
): Partial<TransactionEntity> & Pick<TransactionEntity, 'id'> {
  const suggestions = transaction.suggestions ?? {};
  const resolved = SIMPLE_FIELDS.filter(
    field => suggestions[field] && (!fields || fields.includes(field)),
  );

  const diff: Partial<TransactionEntity> & Pick<TransactionEntity, 'id'> = {
    id: transaction.id,
    suggestions: removeSuggestions(suggestions, resolved),
  };
  for (const field of resolved) {
    const value = suggestions[field]?.value;
    // A split parent never has its own category, so it is dropped unused
    const isParentCategory = field === 'category' && transaction.is_parent;
    if (value != null && !isParentCategory && isUsable(field, value)) {
      diff[field] = value;
    }
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
    if (!(SIMPLE_FIELDS as readonly string[]).includes(field)) {
      fail(`unsupported field "${field}"`);
    }
    result[field as (typeof SIMPLE_FIELDS)[number]] = validateEntry(
      field,
      entry,
      source,
    );
  }
  return normalize(result);
}
