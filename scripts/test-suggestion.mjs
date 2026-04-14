import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as api from '../packages/api/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '.test-suggestion-data');

async function main() {
  // Clean up from previous runs
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });

  await api.init({
    serverURL: 'http://localhost:5006',
    password: 'test123',
    dataDir,
  });

  const budgets = await api.getBudgets();
  const targetSyncId = '60672e05-b449-4d8c-b2b7-e7e76044da34';
  const budget =
    budgets.find(b => b.groupId === targetSyncId) ??
    budgets[budgets.length - 1];

  const syncId = budget.groupId;
  if (!syncId) {
    console.log('Budget has no sync id.');
    await api.shutdown();
    return;
  }

  console.log(`Loading: ${budget.name}`);
  await api.downloadBudget(syncId);

  // Get accounts
  const accounts = await api.getAccounts();
  console.log(
    'Accounts:',
    accounts.map(a => `${a.name} (${a.id})`),
  );

  let checkingsId = accounts.find(a => a.name === 'Checkings')?.id;
  let savingsId = accounts.find(a => a.name === 'Savings')?.id;

  // Create accounts if they don't exist
  if (!checkingsId) {
    checkingsId = await api.createAccount({ name: 'Checkings' }, 100000);
    console.log('Created Checkings account:', checkingsId);
  }
  if (!savingsId) {
    savingsId = await api.createAccount({ name: 'Savings' }, 50000);
    console.log('Created Savings account:', savingsId);
  }

  // Get categories and payees
  const categories = await api.getCategories();
  const foodCategory = categories.find(c => c.name === 'Food');
  const generalCategory = categories.find(c => c.name === 'General');

  // Create categories if needed
  let foodCatId = foodCategory?.id;
  let generalCatId = generalCategory?.id;
  if (!foodCatId) {
    const groups = await api.getCategoryGroups();
    const groupId = groups[0]?.id;
    foodCatId = await api.createCategory({ name: 'Food', group_id: groupId });
  }
  if (!generalCatId) {
    const groups = await api.getCategoryGroups();
    const groupId = groups[0]?.id;
    generalCatId = await api.createCategory({
      name: 'General',
      group_id: groupId,
    });
  }

  // Create payees
  let groceryPayeeId = (await api.getPayees()).find(
    p => p.name === 'Whole Foods',
  )?.id;
  if (!groceryPayeeId) {
    groceryPayeeId = await api.createPayee({ name: 'Whole Foods' });
  }

  // ============================================================
  // Case A: Uncategorized transaction with category suggestion
  // ============================================================
  console.log('\n--- Case A: Uncategorized transaction ---');
  await api.addTransactions(checkingsId, [
    {
      date: '2026-04-14',
      amount: -4500,
      imported_id: 'qa-case-a',
      payee: groceryPayeeId,
    },
  ]);
  let txns = await api.getTransactions(checkingsId, '2026-04-14', '2026-04-14');
  const caseATxn = txns.find(t => t.imported_id === 'qa-case-a');
  console.log(`  Transaction: ${caseATxn.id} (no category)`);

  await api.createSuggestion(caseATxn.id, { category: foodCatId }, 'llm', {
    confidence: 0.95,
    sourceId: 'gpt-4',
  });
  console.log(`  Suggestion: category → Food`);

  // ============================================================
  // Case B: Transaction with notes+category, suggest different ones
  // ============================================================
  console.log('\n--- Case B: Transaction with existing notes & category ---');
  await api.addTransactions(checkingsId, [
    {
      date: '2026-04-13',
      amount: -12000,
      imported_id: 'qa-case-b',
      payee: groceryPayeeId,
      category: generalCatId,
      notes: 'weekly shopping',
    },
  ]);
  txns = await api.getTransactions(checkingsId, '2026-04-13', '2026-04-13');
  const caseBTxn = txns.find(t => t.imported_id === 'qa-case-b');
  console.log(
    `  Transaction: ${caseBTxn.id} (category=General, notes="weekly shopping")`,
  );

  await api.createSuggestion(
    caseBTxn.id,
    { category: foodCatId, notes: 'Groceries - weekly run' },
    'llm',
    { confidence: 0.88, sourceId: 'gpt-4' },
  );
  console.log(
    `  Suggestion: category → Food, notes → "Groceries - weekly run"`,
  );

  // ============================================================
  // Case C: Two transactions that should be a transfer
  // ============================================================
  console.log('\n--- Case C: Transfer suggestion ---');

  // Get transfer payees (each account has a transfer payee)
  const payees = await api.getPayees();
  const savingsTransferPayee = payees.find(p => p.transfer_acct === savingsId);
  const checkingsTransferPayee = payees.find(
    p => p.transfer_acct === checkingsId,
  );

  console.log(
    `  Transfer payees: Savings=${savingsTransferPayee?.id}, Checkings=${checkingsTransferPayee?.id}`,
  );

  // Create two separate transactions that should be linked as a transfer
  await api.addTransactions(checkingsId, [
    {
      date: '2026-04-12',
      amount: -50000,
      imported_id: 'qa-case-c-from',
      notes: 'Transfer to savings',
    },
  ]);
  await api.addTransactions(savingsId, [
    {
      date: '2026-04-12',
      amount: 50000,
      imported_id: 'qa-case-c-to',
      notes: 'Transfer from checking',
    },
  ]);

  txns = await api.getTransactions(checkingsId, '2026-04-12', '2026-04-12');
  const caseCFromTxn = txns.find(t => t.imported_id === 'qa-case-c-from');

  txns = await api.getTransactions(savingsId, '2026-04-12', '2026-04-12');
  const caseCToTxn = txns.find(t => t.imported_id === 'qa-case-c-to');

  console.log(`  Checkings txn: ${caseCFromTxn.id} (-500.00)`);
  console.log(`  Savings txn: ${caseCToTxn.id} (+500.00)`);

  // Suggest setting the payee to the transfer payee (which triggers transfer linking)
  if (savingsTransferPayee) {
    await api.createSuggestion(
      caseCFromTxn.id,
      { payee: savingsTransferPayee.id },
      'llm',
      { confidence: 0.9, sourceId: 'gpt-4', groupId: 'transfer-group-1' },
    );
    console.log(`  Suggestion on checkings txn: payee → transfer to Savings`);
  }

  if (checkingsTransferPayee) {
    await api.createSuggestion(
      caseCToTxn.id,
      { payee: checkingsTransferPayee.id },
      'llm',
      { confidence: 0.9, sourceId: 'gpt-4', groupId: 'transfer-group-1' },
    );
    console.log(`  Suggestion on savings txn: payee → transfer to Checkings`);
  }

  // ============================================================
  // Case D: Split transaction with suggestions on child transactions
  // ============================================================
  console.log('\n--- Case D: Split transaction with child suggestions ---');

  // Create a split transaction: parent + 2 children
  const splitResult = await api.importTransactions(checkingsId, [
    {
      date: '2026-04-15',
      amount: -8000,
      imported_id: 'qa-case-d-parent',
      payee_name: 'Target',
      subtransactions: [
        {
          amount: -5000,
          notes: 'groceries',
        },
        {
          amount: -3000,
          notes: 'household items',
        },
      ],
    },
  ]);
  console.log(`  Split import result: added=${splitResult.added.length}`);

  // Find all transactions on that date (parent + children)
  txns = await api.getTransactions(checkingsId, '2026-04-15', '2026-04-15');
  console.log(`  Found ${txns.length} transactions on 2026-04-15:`);
  for (const t of txns) {
    console.log(
      `    ${t.id} is_parent=${t.is_parent} is_child=${t.is_child} parent_id=${t.parent_id} amount=${t.amount} notes="${t.notes}" category=${t.category}`,
    );
  }
  // Also check subtransactions on grouped results
  const splitParent = txns.find(t => t.is_parent || t.subtransactions?.length > 0);
  const splitChildren = splitParent?.subtransactions ?? txns.filter(t => t.is_child);

  console.log(`  Found ${splitChildren.length} child transactions`);

  // Add suggestions to the uncategorized children
  if (splitChildren.length >= 2) {
    await api.createSuggestion(
      splitChildren[0].id,
      { category: foodCatId },
      'llm',
      { confidence: 0.91, sourceId: 'gpt-4' },
    );
    console.log(`  Suggestion on child 1: category → Food`);

    await api.createSuggestion(
      splitChildren[1].id,
      { category: generalCatId },
      'llm',
      { confidence: 0.85, sourceId: 'gpt-4' },
    );
    console.log(`  Suggestion on child 2: category → General`);
  }

  // ============================================================
  // Case E: Split transaction with suggestion on parent AND children
  // ============================================================
  console.log(
    '\n--- Case E: Split with suggestions on parent + children ---',
  );

  const splitResult2 = await api.importTransactions(checkingsId, [
    {
      date: '2026-04-16',
      amount: -15000,
      imported_id: 'qa-case-e-parent',
      payee_name: 'Costco',
      subtransactions: [
        {
          amount: -9000,
          notes: 'bulk food',
        },
        {
          amount: -6000,
          notes: 'electronics',
        },
      ],
    },
  ]);
  console.log(`  Split import result: added=${splitResult2.added.length}`);

  txns = await api.getTransactions(checkingsId, '2026-04-16', '2026-04-16');
  const splitParent2 = txns.find(
    t => t.is_parent || t.subtransactions?.length > 0,
  );
  const splitChildren2 =
    splitParent2?.subtransactions ?? txns.filter(t => t.is_child);

  console.log(
    `  Parent: ${splitParent2?.id} amount=${splitParent2?.amount}`,
  );
  console.log(`  Found ${splitChildren2.length} child transactions`);

  // Suggestion on the parent: change payee
  if (splitParent2) {
    let costcoPayeeId = (await api.getPayees()).find(
      p => p.name === 'Costco Wholesale',
    )?.id;
    if (!costcoPayeeId) {
      costcoPayeeId = await api.createPayee({ name: 'Costco Wholesale' });
    }

    await api.createSuggestion(
      splitParent2.id,
      { payee: costcoPayeeId },
      'llm',
      { confidence: 0.93, sourceId: 'gpt-4' },
    );
    console.log(`  Suggestion on parent: payee → Costco Wholesale`);
  }

  // Suggestions on children: categories
  if (splitChildren2.length >= 2) {
    await api.createSuggestion(
      splitChildren2[0].id,
      { category: foodCatId },
      'llm',
      { confidence: 0.94, sourceId: 'gpt-4' },
    );
    console.log(`  Suggestion on child 1: category → Food`);

    await api.createSuggestion(
      splitChildren2[1].id,
      { category: generalCatId },
      'llm',
      { confidence: 0.82, sourceId: 'gpt-4' },
    );
    console.log(`  Suggestion on child 2: category → General`);
  }

  // ============================================================
  await api.sync();
  console.log('\nAll done! Refresh your browser to see the suggestions.');

  await api.shutdown();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
