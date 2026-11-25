# Transaction Suggestions

<ExperimentalFeatureWarning issueId="7001" />

:::warning
All functionality described here may not be available in the latest stable release. See [Experimental Features](./index.md) for instructions to enable experimental features. Use the `nightly` images for the latest implementation.
:::

A suggestion is a change to a transaction that waits for you to approve it. Rules and other tools (through the [API](../api/reference.md#suggesttransactionchanges)) can suggest a cleaner payee, a note, a category, a split or a transfer. Nothing on the transaction changes until you accept the suggestion.

To turn it on, go to **Settings → Experimental** and check **Transaction suggestions**.

## Reviewing suggestions

Suggested values show in the register in purple italics. When the field already has a value, the current value is shown struck through, followed by the suggestion. Each row with suggestions has two buttons in the category column:

- **✓** applies all of the row's suggestions
- **✕** dismisses them

Editing a field by hand replaces that field's suggestion. Accepting a suggestion on a reconciled transaction asks for confirmation first, like any other edit to a reconciled transaction.

When an account has suggestions, its header shows **Review suggestions · N**. Clicking it filters the register to the transactions with suggestions; the same filter is available as **Has suggestions** in the filter menu. To handle many at once, select them and choose **Accept suggestions** or **Dismiss suggestions** from the selection menu.

Undo works for accepting and dismissing, as for any other edit.

### Splits

A suggested split shows **Split into N** in the category cell, with a preview row under the transaction for each part. Accepting it turns the transaction into a split transaction with those parts. If the transaction's amount changed after the split was suggested, the split no longer adds up: it isn't applied, it stays pending, and you get a notification. Dismiss it, or split the transaction yourself.

### Transfers

A suggested transfer links two transactions in different accounts as the two legs of a transfer. Both legs show **Transfer: _other account_** as the suggested payee. Accepting or dismissing either leg does it for both. Linking works like **Make transfer**: the category is cleared unless the transfer moves money in or out of the budget. Transfers can only be suggested through the API for now.

## Rules that suggest

In the [rule editor](../budgeting/rules/index.md), an action can use **suggest** instead of **set**. A `suggest` action works out its value the same way `set` does, including formulas, but stores it as a suggestion instead of changing the field. It works for the payee, notes and category fields, and in split actions: a split whose actions use `suggest` is stored as a split suggestion, and the transaction is not split. A split can't mix `set` and `suggest` actions.

Suggest rules run when transactions are imported or synced, when a schedule posts a transaction, when you use **Run rules**, and when you use **Apply actions** in the rule editor. They don't run while you enter a transaction by hand.

### Category learning

When **Category learning** is on, Actual creates a rule after you categorize a payee's transactions the same way a few times. In **Payees → Category learning settings** you can choose **Create new automatic rules as suggestions**, so new learned rules suggest the category instead of setting it. Existing learned rules keep their action.

## Trying it in the demo budget

The demo budget (**Try the demo** on the welcome screen) contains one example of each kind of suggestion, plus two demo rules that use `suggest`. Experimental features are set per budget, so open the demo budget first, turn the feature on in its **Settings → Experimental**, then open **All accounts** and click **Review suggestions**.

## Limitations

- A suggested payee doesn't feed later rules: rules see the transaction's current payee until the suggestion is accepted.
- While the feature is turned off, `suggest` rules do nothing, and learned rules created as suggestions don't categorize.
- Devices running an older version of Actual don't know about suggestions. Update every device before using them, or those devices may fail to sync or create competing learned rules.
- The ✓ and ✕ buttons sit in the category column, so they aren't shown when that column is hidden; use the selection menu instead.
