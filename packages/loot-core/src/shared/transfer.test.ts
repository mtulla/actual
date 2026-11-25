// @ts-strict-ignore
import * as db from '#server/db';

import * as transfer from './transfer';

beforeEach(global.emptyDatabase());

async function prepareDatabase() {
  await db.insertAccount({ id: 'one', name: 'one' });
  await db.insertAccount({ id: 'two', name: 'two' });
  await db.insertPayee({ name: '', transfer_acct: 'one' });
  await db.insertPayee({ name: '', transfer_acct: 'two' });
}

async function createTransaction(account: string, amount: number, extra = {}) {
  const transaction = {
    id: null,
    account,
    amount,
    payee: await db.insertPayee({ name: 'Non-transfer ' + account }),
    date: '2017-01-01',
    ...extra,
  };
  transaction.id = await db.insertTransaction(transaction);
  return await db.getTransaction(transaction.id);
}

describe('Transfer', () => {
  test('Transfers are properly verified', async () => {
    await prepareDatabase();

    // happy path, two valid transactions
    expect(
      transfer.validForTransfer(
        await createTransaction('one', 5),
        await createTransaction('two', -5),
      ),
    ).toBeTruthy();

    // amount not zeroed out
    expect(
      transfer.validForTransfer(
        await createTransaction('one', 5),
        await createTransaction('two', 5),
      ),
    ).toBeFalsy();

    // amount not match
    expect(
      transfer.validForTransfer(
        await createTransaction('one', 5),
        await createTransaction('two', -6),
      ),
    ).toBeFalsy();

    // accounts match
    expect(
      transfer.validForTransfer(
        await createTransaction('one', 5),
        await createTransaction('one', -5),
      ),
    ).toBeFalsy();

    // one already a transfer
    const existingTransfer = await createTransaction('one', 5);
    expect(
      transfer.validForTransfer(
        await createTransaction('one', 5),
        await createTransaction('two', -5, {
          transfer_id: existingTransfer.id,
        }),
      ),
    ).toBeFalsy();
  });
});

describe('getTransferLinkUpdates', () => {
  const payees = [
    { id: 'to-checking', transfer_acct: 'checking' },
    { id: 'to-savings', transfer_acct: 'savings' },
    { id: 'to-401k', transfer_acct: '401k' },
  ];
  const accounts = [
    { id: 'checking', offbudget: 0 },
    { id: 'savings', offbudget: 0 },
    { id: '401k', offbudget: 1 },
  ];
  const leg = (id, account, amount) => ({
    id,
    account,
    amount,
    date: '2024-01-01',
    category: 'food',
    suggestions: { transfer: { value: 'x', source: 'api' } },
  });

  test('links both legs and clears the category on budget', () => {
    expect(
      transfer.getTransferLinkUpdates(
        leg('a', 'checking', -100),
        leg('b', 'savings', 100),
        accounts,
        payees,
      ),
    ).toEqual([
      {
        id: 'a',
        category: null,
        payee: 'to-savings',
        transfer_id: 'b',
        suggestions: null,
      },
      {
        id: 'b',
        category: null,
        payee: 'to-checking',
        transfer_id: 'a',
        suggestions: null,
      },
    ]);
  });

  test('keeps the category for a transfer out of the budget', () => {
    const [from] = transfer.getTransferLinkUpdates(
      leg('a', 'checking', -100),
      leg('b', '401k', 100),
      accounts,
      payees,
    );
    expect(from).not.toHaveProperty('category');
    expect(from.payee).toBe('to-401k');
  });
});
