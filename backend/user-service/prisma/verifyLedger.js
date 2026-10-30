#!/usr/bin/env node
/**
 * Read-only integrity check for the double-entry ledger.
 *
 * Verifies that every journal entry balances, that account and wallet balances
 * match their postings, that transaction lifecycle states agree with their
 * journal entries, and that migrated LEGACY rows were never reinterpreted as
 * ledger entries. Exits non-zero when any check fails.
 *
 * Usage: DATABASE_URL=... npm run ledger:verify
 */
const prisma = require("../src/config/database");
const { decimalStringToMinorUnits } = require("../src/modules/wallets/money");

const failures = [];
const fail = (check, detail) => failures.push({ check, detail });
const cents = (value) => decimalStringToMinorUnits(String(value));

const sum = (values) => values.reduce((total, value) => total + value, 0n);

const checkEntryBalance = (entries) => {
  for (const entry of entries) {
    const debit = sum(
      entry.postings
        .filter((posting) => posting.direction === "DEBIT")
        .map((posting) => cents(posting.amount))
    );
    const credit = sum(
      entry.postings
        .filter((posting) => posting.direction === "CREDIT")
        .map((posting) => cents(posting.amount))
    );
    if (entry.postings.length < 2) {
      fail("entry-minimum-postings", `${entry.reference} has ${entry.postings.length} postings`);
    }
    if (debit !== credit) {
      fail("entry-unbalanced", `${entry.reference} debit ${debit} credit ${credit}`);
    }
    const wrongCurrency = entry.postings.filter(
      (posting) => posting.currency !== entry.currency
    );
    if (wrongCurrency.length > 0) {
      fail("entry-currency", `${entry.reference} has postings in another currency`);
    }
    if (entry.status !== "POSTED") {
      fail("entry-status", `${entry.reference} has status ${entry.status}`);
    }
  }
};

const checkAccounts = (accounts, wallets) => {
  let debitNormalTotal = 0n;
  let creditNormalTotal = 0n;
  for (const account of accounts) {
    const debit = sum(
      account.postings
        .filter((posting) => posting.direction === "DEBIT")
        .map((posting) => cents(posting.amount))
    );
    const credit = sum(
      account.postings
        .filter((posting) => posting.direction === "CREDIT")
        .map((posting) => cents(posting.amount))
    );
    const projected =
      account.normalBalance === "DEBIT" ? debit - credit : credit - debit;
    const stored = cents(account.balance);
    if (account.normalBalance === "DEBIT") {
      debitNormalTotal += projected;
    } else {
      creditNormalTotal += projected;
    }

    if (projected !== stored) {
      fail(
        "account-projection",
        `${account.code} stored ${stored} derived ${projected}`
      );
    }
    if (account.wallet && cents(account.wallet.balance) !== stored) {
      fail(
        "wallet-projection",
        `wallet ${account.walletId} balance ${account.wallet.balance} account ${account.balance}`
      );
    }
    if (account.wallet && account.wallet.currency !== account.currency) {
      fail("wallet-currency", `wallet ${account.walletId} differs from account currency`);
    }
  }

  if (debitNormalTotal !== creditNormalTotal) {
    fail(
      "trial-balance",
      `debit-normal ${debitNormalTotal} credit-normal ${creditNormalTotal}`
    );
  }

  const unlinked = wallets.filter((wallet) => !wallet.ledgerAccount);
  for (const wallet of unlinked) {
    fail("wallet-missing-account", `wallet ${wallet.id} has no ledger account`);
  }
};

const checkTransactionState = (transaction) => {
  const amount = cents(transaction.amount);
  const reversed = cents(transaction.reversedAmount);
  const reversalTotal = sum(transaction.reversals.map((row) => cents(row.amount)));

  if (transaction.status === "LEGACY") {
    if (transaction.journalEntry) {
      fail("legacy-has-entry", `${transaction.reference} LEGACY row has a journal entry`);
    }
    if (transaction.reversals.length > 0) {
      fail("legacy-reversed", `${transaction.reference} LEGACY row has reversals`);
    }
    return;
  }

  if (!transaction.journalEntry) {
    fail("transaction-missing-entry", `${transaction.reference} has no journal entry`);
  } else if (transaction.journalEntry.transactionId !== transaction.id) {
    fail("transaction-entry-link", `${transaction.reference} journal link is inconsistent`);
  }
  if (reversalTotal !== reversed) {
    fail(
      "reversed-amount",
      `${transaction.reference} reversedAmount ${reversed} reversals ${reversalTotal}`
    );
  }
  if (reversed > amount) {
    fail("reversed-bounds", `${transaction.reference} reversed ${reversed} > amount ${amount}`);
  }

  const expectedStatus =
    reversed === 0n
      ? "POSTED"
      : reversed === amount
        ? "REVERSED"
        : "PARTIALLY_REVERSED";
  if (transaction.status !== expectedStatus) {
    fail(
      "transaction-status",
      `${transaction.reference} status ${transaction.status} expected ${expectedStatus}`
    );
  }

  if (transaction.type === "DEPOSIT") {
    if (!transaction.payment) {
      fail("deposit-payment-missing", `${transaction.reference} has no payment link`);
    } else {
      if (transaction.payment.status !== "COMPLETED") {
        fail("deposit-payment-status", `${transaction.reference} payment is ${transaction.payment.status}`);
      }
      if (cents(transaction.payment.amount) !== amount) {
        fail("deposit-amount", `${transaction.reference} amount differs from payment`);
      }
      if (transaction.payment.currency !== transaction.currency) {
        fail("deposit-currency", `${transaction.reference} currency differs from payment`);
      }
    }
  }
};

const checkReversals = (reversals) => {
  for (const reversal of reversals) {
    if (cents(reversal.amount) <= 0n) {
      fail("reversal-amount", `${reversal.reference} is not positive`);
    }
    if (reversal.currency !== reversal.transaction.currency) {
      fail("reversal-currency", `${reversal.reference} currency mismatch`);
    }
    if (reversal.transaction.status === "LEGACY") {
      fail("reversal-legacy", `${reversal.reference} targets a LEGACY transaction`);
    }
    if (!reversal.journalEntry.reversalOfId) {
      fail("reversal-entry-link", `${reversal.reference} entry does not reference an original`);
    }
    if (
      reversal.transaction.journalEntry &&
      reversal.journalEntry.reversalOfId !== reversal.transaction.journalEntry.id
    ) {
      fail(
        "reversal-entry-target",
        `${reversal.reference} entry reverses a different journal entry`
      );
    }
  }
};

const checkWithdrawals = (withdrawals, reservedAccount) => {
  let pendingTotal = 0n;
  for (const withdrawal of withdrawals) {
    if (!["PENDING", "CANCELLED"].includes(withdrawal.status)) {
      fail("withdrawal-status", `${withdrawal.reference} has status ${withdrawal.status}`);
    }
    if (withdrawal.status === "PENDING") {
      pendingTotal += cents(withdrawal.amount);
      if (!withdrawal.journalEntry) {
        fail("withdrawal-reservation", `${withdrawal.reference} has no reservation entry`);
      }
    }
    if (withdrawal.status === "CANCELLED" && !withdrawal.journalEntry) {
      fail("withdrawal-reservation", `${withdrawal.reference} lost its reservation entry`);
    }
  }

  if (reservedAccount && cents(reservedAccount.balance) !== pendingTotal) {
    fail(
      "withdrawal-reserved-balance",
      `reserved account ${reservedAccount.balance} pending withdrawals ${pendingTotal}`
    );
  }
};

const checkPayments = (payments) => {
  for (const payment of payments) {
    if (payment.status === "COMPLETED" && !payment.transaction) {
      fail("payment-completed-without-transaction", `${payment.reference} is COMPLETED without a transaction`);
    }
    if (payment.status !== "COMPLETED" && payment.transaction) {
      fail("payment-transaction-state", `${payment.reference} ${payment.status} has a transaction`);
    }
  }
};

const main = async () => {
  const [entries, accounts, wallets, transactions, reversals, withdrawals, payments] =
    await Promise.all([
      prisma.journalEntry.findMany({
        include: {
          postings: true,
          transaction: { select: { id: true, reference: true, status: true } },
          withdrawal: { select: { id: true, reference: true } },
          reversalRecord: { select: { id: true } },
        },
      }),
      prisma.ledgerAccount.findMany({ include: { postings: true, wallet: true } }),
      prisma.wallet.findMany({
        select: { id: true, balance: true, currency: true, ledgerAccount: { select: { id: true } } },
      }),
      prisma.transaction.findMany({
        include: {
          journalEntry: { select: { id: true, transactionId: true } },
          reversals: { select: { amount: true } },
          payment: { select: { status: true, amount: true, currency: true } },
        },
      }),
      prisma.transactionReversal.findMany({
        include: {
          transaction: {
            include: { journalEntry: { select: { id: true } } },
          },
          journalEntry: { select: { id: true, reversalOfId: true } },
        },
      }),
      prisma.withdrawal.findMany({
        include: { journalEntry: { select: { id: true } } },
      }),
      prisma.payment.findMany({
        include: { transaction: { select: { id: true, reference: true } } },
      }),
    ]);

  checkEntryBalance(entries);
  checkAccounts(accounts, wallets);
  transactions.forEach(checkTransactionState);
  checkReversals(reversals);
  checkWithdrawals(
    withdrawals,
    accounts.find((account) => account.code === "PLATFORM:WITHDRAWAL_RESERVED")
  );
  checkPayments(payments);

  const legacyCount = transactions.filter((row) => row.status === "LEGACY").length;
  console.log("Ledger integrity report");
  console.log(`  journal entries : ${entries.length}`);
  console.log(`  ledger accounts : ${accounts.length}`);
  console.log(`  wallets         : ${wallets.length}`);
  console.log(`  transactions    : ${transactions.length} (LEGACY ${legacyCount})`);
  console.log(`  reversals       : ${reversals.length}`);
  console.log(`  withdrawals     : ${withdrawals.length}`);
  console.log(`  payments        : ${payments.length}`);

  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.length} integrity violation(s)`);
    for (const failure of failures) {
      console.error(`  [${failure.check}] ${failure.detail}`);
    }
    return 1;
  }
  console.log("\nOK: ledger integrity checks passed");
  return 0;
};

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
