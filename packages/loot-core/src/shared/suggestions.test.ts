import {
  buildAcceptDiff,
  filledSuggestionFields,
  mergeSuggestions,
  removeSuggestions,
  validateSuggestions,
} from './suggestions';

const category = { value: 'cat-1', source: 'rule' as const };
const notes = { value: 'Paper towels', source: 'api' as const };

describe('suggestions', () => {
  test('empty suggestions are stored as null', () => {
    expect(mergeSuggestions(null, {})).toBeNull();
    expect(removeSuggestions({ category }, ['category'])).toBeNull();
    expect(removeSuggestions({ category, notes })).toBeNull();
    expect(validateSuggestions({})).toBeNull();
  });

  test('merge overrides per field and keeps the rest', () => {
    const next = { value: 'cat-2', source: 'api' as const };
    expect(mergeSuggestions({ category, notes }, { category: next })).toEqual({
      category: next,
      notes,
    });
  });

  test('remove only drops the given fields', () => {
    expect(removeSuggestions({ category, notes }, ['notes'])).toEqual({
      category,
    });
  });

  test('accept diff writes values and clears accepted suggestions', () => {
    const transaction = { id: 't1', suggestions: { category, notes } };
    expect(buildAcceptDiff(transaction)).toEqual({
      id: 't1',
      category: 'cat-1',
      notes: 'Paper towels',
      suggestions: null,
    });
    expect(buildAcceptDiff(transaction, ['notes'])).toEqual({
      id: 't1',
      notes: 'Paper towels',
      suggestions: { category },
    });
  });

  test('accept diff drops suggestions it cannot apply', () => {
    // A split parent has no category of its own
    expect(
      buildAcceptDiff({ id: 'p', is_parent: true, suggestions: { category } }),
    ).toEqual({ id: 'p', suggestions: null });
    // e.g. the suggested category was deleted
    expect(
      buildAcceptDiff(
        { id: 't1', suggestions: { category, notes } },
        undefined,
        field => field !== 'category',
      ),
    ).toEqual({ id: 't1', notes: 'Paper towels', suggestions: null });
  });

  test('filled fields are those that were empty and got a value', () => {
    expect(
      filledSuggestionFields(
        { category, notes },
        { category: null, notes: 'old' },
        { category: 'cat-9', notes: 'new' },
      ),
    ).toEqual(['category']);
  });

  test('accept diff on a transaction without suggestions changes nothing', () => {
    expect(buildAcceptDiff({ id: 't1', suggestions: null })).toEqual({
      id: 't1',
      suggestions: null,
    });
  });

  test('validate can force the source', () => {
    expect(
      validateSuggestions(
        { notes: { value: 'x', source: 'rule' } },
        { source: 'api' },
      ),
    ).toEqual({ notes: { value: 'x', source: 'api' } });
  });

  test('validate accepts well-formed input and drops unknown keys', () => {
    expect(
      validateSuggestions({
        category: { value: 'cat-1', source: 'api', confidence: 0.9, x: 1 },
      }),
    ).toEqual({ category: { value: 'cat-1', source: 'api', confidence: 0.9 } });
  });

  test.each([
    ['not an object', 'nope'],
    ['a number', 5],
    ['an array', []],
    ['an unsupported field', { amount: { value: '1', source: 'api' } }],
    ['a non-string value', { category: { value: 3, source: 'api' } }],
    ['an unknown source', { category: { value: 'c', source: 'ai' } }],
    [
      'a confidence out of range',
      { category: { value: 'c', source: 'api', confidence: 2 } },
    ],
    [
      'a value that is too long',
      { notes: { value: 'x'.repeat(1001), source: 'api' } },
    ],
    [
      'a split with one part',
      { split: { value: [{ amount: 1 }], source: 'api' } },
    ],
    [
      'a split with a fractional amount',
      { split: { value: [{ amount: 1.5 }, { amount: 2 }], source: 'api' } },
    ],
  ])('validate rejects %s', (_, input) => {
    expect(() => validateSuggestions(input)).toThrow('Invalid suggestion');
  });

  describe('split', () => {
    const split = {
      value: [{ amount: -100, category: 'food' }, { amount: -50 }],
      source: 'api' as const,
    };

    test('accept turns a matching split into subtransactions', () => {
      expect(
        buildAcceptDiff({
          id: 't',
          amount: -150,
          is_parent: false,
          suggestions: {
            split,
            category: { value: 'fun', source: 'rule' },
          },
        }),
      ).toEqual({
        id: 't',
        suggestions: null,
        subtransactions: [{ amount: -100, category: 'food' }, { amount: -50 }],
      });
    });

    test('accept leaves a split pending when the amount changed', () => {
      expect(
        buildAcceptDiff({
          id: 't',
          amount: -200,
          is_parent: false,
          suggestions: { split },
        }),
      ).toEqual({ id: 't', suggestions: { split } });
    });

    test('accept drops a split on a row that is already split', () => {
      expect(
        buildAcceptDiff({
          id: 't',
          amount: -150,
          is_parent: true,
          suggestions: { split },
        }),
      ).toEqual({ id: 't', suggestions: null });
    });

    test('validate keeps the split parts', () => {
      expect(
        validateSuggestions({ split: { ...split, source: 'rule' } }),
      ).toEqual({ split: { ...split, source: 'rule' } });
    });
  });
});
