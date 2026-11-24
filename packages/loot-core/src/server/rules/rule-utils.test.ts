import { Rule } from './rule';
import { migrateIds, parseBetweenDate } from './rule-utils';

describe('migrateIds', () => {
  it('remaps the values of set and suggest actions', () => {
    const rule = new Rule({
      conditionsOp: 'and',
      conditions: [{ op: 'is', field: 'notes', value: 'x', options: null }],
      actions: [
        { op: 'set', field: 'payee', value: 'payee-a' },
        { op: 'suggest', field: 'category', value: 'cat-a' },
      ],
    });

    migrateIds(
      rule,
      new Map([
        ['payee-a', 'payee-b'],
        ['cat-a', 'cat-b'],
      ]),
    );

    expect(rule.actions.map(a => a.value)).toEqual(['payee-b', 'cat-b']);
  });

  it('deduplicates mapped IDs in oneOf and notOneOf conditions', () => {
    const rule = new Rule({
      conditionsOp: 'and',
      conditions: [
        {
          op: 'oneOf',
          field: 'payee',
          value: ['payee-a', 'payee-b', 'payee-c'],
          options: null,
        },
        {
          op: 'notOneOf',
          field: 'payee',
          value: ['payee-a', 'payee-b', 'payee-c'],
          options: null,
        },
      ],
      actions: [],
    });
    const mappings = new Map([
      ['payee-a', 'payee-merged'],
      ['payee-b', 'payee-merged'],
    ]);

    migrateIds(rule, mappings);

    expect(rule.conditions[0].rawValue).toEqual([
      'payee-a',
      'payee-b',
      'payee-c',
    ]);
    expect(rule.conditions[0].value).toEqual(['payee-merged', 'payee-c']);
    expect(rule.conditions[0].unparsedValue).toEqual([
      'payee-merged',
      'payee-c',
    ]);
    expect(rule.conditions[1].rawValue).toEqual([
      'payee-a',
      'payee-b',
      'payee-c',
    ]);
    expect(rule.conditions[1].value).toEqual(['payee-merged', 'payee-c']);
    expect(rule.conditions[1].unparsedValue).toEqual([
      'payee-merged',
      'payee-c',
    ]);
  });
});

describe('parseBetweenDate', () => {
  it('parses a pair of exact dates', () => {
    expect(
      parseBetweenDate({ num1: '2020-01-01', num2: '2020-01-31' }),
    ).toEqual({ type: 'between', num1: '2020-01-01', num2: '2020-01-31' });
  });

  it('rejects values that are not a pair of dates', () => {
    expect(parseBetweenDate(null)).toBe(null);
    expect(parseBetweenDate('2020-01-01')).toBe(null);
    expect(parseBetweenDate({ num1: '2020-01-01' })).toBe(null);
    expect(parseBetweenDate({ num1: '2020-01-01', num2: 'hello' })).toBe(null);
    expect(parseBetweenDate({ num1: 1, num2: 2 })).toBe(null);
  });

  it('rejects month and year bounds', () => {
    expect(parseBetweenDate({ num1: '2020-01', num2: '2020-03' })).toBe(null);
    expect(parseBetweenDate({ num1: '2020', num2: '2021' })).toBe(null);
    expect(parseBetweenDate({ num1: '2020-01-01', num2: '2020-03' })).toBe(
      null,
    );
  });

  it('rejects invalid dates', () => {
    expect(parseBetweenDate({ num1: '2020-14-01', num2: '2020-01-31' })).toBe(
      null,
    );
    expect(parseBetweenDate({ num1: '2020-01-01', num2: '2020-05-53' })).toBe(
      null,
    );
  });
});
