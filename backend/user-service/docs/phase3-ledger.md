# Phase 3 — Double-entry ledger and transaction integrity

This document describes the accounting model and the operational guarantees added
to `user-service` in Phase 3. It is written for the development/test deployment in
this repository. **Automated tests passing does not make this system ready for real
customer funds.** See [Remaining risks](#15-remaining-risks-and-production-review).

## 1. Scope and non-goals

Implemented in this phase:

- A double-entry ledger (`LedgerAccount`, `JournalEntry`, `LedgerPosting`) that is
  the authoritative record of every wallet movement.
- Ledger-backed transfers, Chapa Test Mode deposits, internal withdrawal
  reservations, and administrator reversals.
- Configurable per-type limits and fees enforced server-side from the database.
- Reconciliation of stale pending deposits against the trusted provider.
- Database-level invariants (triggers/constraints) in addition to service checks.

Not implemented (and not simulated):

- Real cash settlement, bank accounts, or provider settlement reconciliation.
- Withdrawal payouts. The configured provider (Chapa) exposes no payout API.
- Provider refunds/chargebacks for deposits.
- FX. Only ETB and same-currency transfers are supported.
- Partial fee refunds on partial reversals (the fee is returned when the
  transaction becomes fully reversed).

## 2. Account model

All money is stored as PostgreSQL `DECIMAL(19,2)` and handled in application code
as integer minor units (`BigInt` cents). JavaScript floating point is never used
for arithmetic.

| Account code | Type | Normal balance | Meaning |
| --- | --- | --- | --- |
| `WALLET:<walletId>` | LIABILITY | CREDIT | Amount owed to the customer. `Wallet.balance` is a projection of this account. |
| `PLATFORM:PROVIDER_CLEARING` | ASSET | DEBIT | Receivable from Chapa for deposits that were verified as successful. It is not a bank cash balance. |
| `PLATFORM:FEE_REVENUE` | REVENUE | CREDIT | Platform fee income. Zero while all seeded fee policies are `NONE`. |
| `PLATFORM:OPENING_BALANCE` | EQUITY | CREDIT | Contra-equity offset for opening wallet liabilities created during migration. Normally negative. |
| `PLATFORM:WITHDRAWAL_RESERVED` | LIABILITY | CREDIT | Customer funds reserved for pending withdrawals (no payout yet). |

A wallet ledger account is created automatically for every new wallet by the
`Wallet_create_ledger_account` trigger. The balance of that account and
`Wallet.balance` are checked against each other at commit.

### Wallet balances are not revenue

A customer wallet balance is a **liability** (money the platform owes the
customer). It must never be recorded as platform income. Only postings to
`PLATFORM:FEE_REVENUE` represent fee income, and a deposit does not create revenue
by itself: it creates a receivable (`PROVIDER_CLEARING`) and a matching customer
liability. The migration's opening entries follow the same rule: they debit
`PLATFORM:OPENING_BALANCE` and credit the wallet liability, so the platform's
equity offset is negative until the historical balances are funded/earned.

### Invariants

For every posted journal entry:

- At least two postings.
- All postings use the entry currency.
- Sum of DEBIT amounts equals sum of CREDIT amounts exactly.
- Status is `POSTED`; ledger rows are immutable (corrections use reversals).

Across all accounts, total debit-normal balances equal total credit-normal
balances (`npm run ledger:verify`).

## 3. Journal model and examples

`JournalEntry` fields: `reference`, `eventType`, `eventRef`, `status`, `currency`,
optional `transactionId`, `withdrawalId`, `reversalOfId`, `metadata`,
`createdByUserId`, `postedAt`. `eventType` + `eventRef` is unique, so a repeated
business event cannot create a second entry.

`LedgerPosting` fields: `journalEntryId`, `ledgerAccountId`, `direction`
(`DEBIT`/`CREDIT`), `amount`, `currency`. `(journalEntryId, ledgerAccountId,
direction)` is unique, which prevents duplicate postings to the same account in
one entry.

### Transfer of 100.00 with a 1.00 fee

```
DEBIT   WALLET:sender          101.00
CREDIT  WALLET:recipient       100.00
CREDIT  PLATFORM:FEE_REVENUE     1.00
```

The sender's wallet is debited the principal plus fee; the recipient receives the
principal.

### Deposit of 50.00 (no fee)

```
DEBIT   PLATFORM:PROVIDER_CLEARING   50.00
CREDIT  WALLET:customer              50.00
```

With a fee, the wallet is credited the net amount and the fee account the rest.

### Partial reversal of 40.00 (fee not refunded yet)

```
DEBIT   WALLET:recipient      40.00
CREDIT  WALLET:sender         40.00
```

### Final reversal completing a 100.00 transfer with 1.00 fee

```
DEBIT   WALLET:recipient      100.00
CREDIT  WALLET:sender         101.00
DEBIT   PLATFORM:FEE_REVENUE    1.00
```

### Withdrawal reservation of 120.00

```
DEBIT   WALLET:customer                 120.00
CREDIT  PLATFORM:WITHDRAWAL_RESERVED    120.00
```

Cancellation posts the mirror image (`DEBIT` reserved, `CREDIT` wallet). No
external payout occurs.

### Opening balance for a migrated wallet with 100.00

```
DEBIT   PLATFORM:OPENING_BALANCE   100.00
CREDIT  WALLET:<walletId>          100.00
```

These entries are created only from the pre-migration `Wallet.balance` snapshot.
Their metadata records the migration name and the source field. No entry is
created for a zero balance, and no arbitrary balancing entries are generated.

## 4. Lifecycle states and transitions

Only states with defined behavior exist.

**Transaction**

| From | To | Trigger |
| --- | --- | --- |
| — | `POSTED` | Ledger-backed transfer/deposit commits |
| `POSTED` | `PARTIALLY_REVERSED` | Partial reversal posted |
| `POSTED` / `PARTIALLY_REVERSED` | `REVERSED` | Remaining amount reversed |
| pre-ledger rows | `LEGACY` | Migration; terminal and not reinterpreted |

Financial fields of a transaction are immutable. `reversedAmount` must equal the
sum of its reversal rows, and `status` must match the reversed amount
(database trigger).

**Payment** (provider status, separate from ledger status)

| From | To | Trigger |
| --- | --- | --- |
| — | `PENDING` | Deposit initialized |
| `PENDING` | `COMPLETED` | Trusted provider verification is SUCCESS with matching reference, amount, currency, and a balanced ledger entry commits in the same DB transaction |
| `PENDING` / `FAILED` | `FAILED` | Provider reports failure or amount/currency mismatch (no credit) |
| `FAILED` | `COMPLETED` | A later trusted verification reports SUCCESS (handles out-of-order webhooks) |
| `COMPLETED` | — | Terminal; replays are no-ops |

A payment cannot become `COMPLETED` without a ledger-backed transaction; a
deferred constraint trigger enforces this. There is no payment state that means
"credited in the ledger but reported as failed".

**Withdrawal**

| From | To | Trigger |
| --- | --- | --- |
| — | `PENDING` | Reservation entry posted |
| `PENDING` | `CANCELLED` | Compensating entry posted |
| `CANCELLED` | — | Terminal; cancel is idempotent |

There is no `COMPLETED` withdrawal state because no payout provider is integrated.

**JournalEntry** is `POSTED` only and immutable.

## 5. Idempotency and concurrency guarantees

| Operation | Idempotency | Concurrency control |
| --- | --- | --- |
| Transfer | `(initiatedByUserId, idempotencyKey)` unique; replay returns the committed transaction (200); same key with different request returns 409 `IDEMPOTENCY_KEY_REUSED` | `SERIALIZABLE` transaction, ordered `SELECT ... FOR UPDATE` wallet locks, retry on serialization failure, balance checked by posting service and DB |
| Reversal | `(transactionId, idempotencyKey)` unique; replay returns the posted reversal (200) | Transaction row `FOR UPDATE`, `SERIALIZABLE`; reversal total constrained by trigger |
| Deposit initiation | `(userId, idempotencyKey)` unique; replay returns the existing payment | Unique constraints |
| Deposit completion | Provider verification replays are no-ops once `COMPLETED`; webhook body hash unique | Conditional update on `status = PENDING`/ledger event uniqueness; DB trigger requires a ledger entry for `COMPLETED` |
| Withdrawal request | `(userId, idempotencyKey)` unique; replay returns the reservation; different amount with same key returns 409 | `SERIALIZABLE`, ordered row locks, advisory lock for daily limits |
| Withdrawal cancel | Already `CANCELLED` returns 200 without a second entry | Row lock `FOR UPDATE` |
| Daily limits | — | `pg_advisory_xact_lock(hashtext(user:type:businessDate))` inside the transaction, then aggregate of committed rows |
| Reconciliation | One record per attempt; repeated/concurrent runs cannot double-credit | Completion is idempotent and ledger event references are unique; manual and scheduled runs are safe to repeat |

All financial writes happen in one database transaction. A failure anywhere rolls
back debits, credits, transaction rows, and ledger entries together.

## 6. Limits, fees, and business dates

Policies live in `FinancialPolicy` (unique `type` + `currency`) and are enforced
server-side for `TRANSFER`, `DEPOSIT`, and `WITHDRAWAL`:

- `minAmount`, `maxAmount`, `dailyOutgoingAmount`, `dailyOutgoingCount`.
- `feeType` (`NONE`, `FLAT`, `PERCENTAGE`, `FLAT_PLUS_PERCENTAGE`), `feeFlat`,
  `feeBps`, `feeMin`, `feeMax`.
- `timezone` (IANA name; seeded `Africa/Addis_Ababa`).

Fee calculation is exact: percentage fees use `(principal * bps + 5000) / 10000`
in integer cents (half-up), then clamp to `feeMin`/`feeMax`. The daily outgoing
amount counts **principal plus fee** (the amount actually debited); the daily
count counts transfers/withdrawals with statuses other than failed/cancelled. The
business date is computed in the policy timezone, not UTC.

Every transfer stores the applied policy decision in `Transaction.policySnapshot`
and `businessDate`. Every policy change requires an ADMIN and a reason of at least
10 characters and writes a `FinancialPolicyRevision` snapshot. The seeded values
are prototype defaults, not regulatory advice.

## 7. Deposit and provider verification

1. `POST /api/v1/payments/deposits` creates a `PENDING` payment with an internal
   reference and a Chapa Test Mode checkout. If Chapa is not configured, the route
   fails closed with 501.
2. A browser redirect never credits a wallet. The frontend calls
   `GET /api/v1/payments/deposits/{reference}/verify`, which asks the provider for
   the authoritative status.
3. The webhook endpoint (`POST /api/v1/payments/webhook`) verifies the HMAC-SHA256
   signature over the exact raw body, requires Test Mode, and re-verifies with the
   provider before acting.
4. Credit is posted only when the provider reports success and the merchant
   reference, provider reference, amount, and currency all match. The transaction,
   journal entry, postings, and `COMPLETED` status commit atomically.
5. If the local ledger step fails (for example an inactive wallet ledger account),
   the payment stays `PENDING`, no transaction or webhook event is stored, and a
   later verification can complete it. Provider success plus local failure is
   recoverable through verification or reconciliation.
6. Amount/currency/reference mismatches mark the payment `FAILED` and return a
   conflict; no credit is posted.

No live credentials are used or required; Test Mode keys are validated to start
with `CHAPA_TEST_`.

## 8. Reconciliation

`reconcilePendingPayments()` selects `PENDING` payments older than
`RECONCILIATION_STALE_MINUTES` (default 15), up to `RECONCILIATION_BATCH_SIZE`
(default 25), re-verifies each with the provider, and writes one
`PaymentReconciliationRecord` per attempt with the attempt number, trigger,
provider status/reference/amount/currency, outcome, and a bounded detail string.

Outcomes:

| Outcome | Meaning |
| --- | --- |
| `MATCHED` | Provider state was applied locally (completed or failed) |
| `PENDING` | Provider still reports an unresolved state; no local change |
| `MISMATCH` | Reference/amount/currency disagreement; no credit; needs review |
| `MANUAL_REVIEW` | Ambiguous state (for example missing local payment/ledger link) |
| `ERROR` | Provider or recording failure; the payment stays pending and is retried next run |

A timeout or transport error is **never** treated as failure. Ambiguous results
are recorded and left pending/manual review. Repeated runs are idempotent and
cannot double-credit; concurrent manual/scheduled runs are safe for the same
reason.

Scheduling uses an in-process interval (`startReconciliationJob`) started from
`server.js`; there is no new broker or scheduler. It is disabled by default,
skips a tick if the previous run is still active, and is stopped during graceful
shutdown. Administrators can trigger a run any time with
`POST /api/v1/admin/payments/reconciliation`.

## 9. Withdrawals

The only implemented withdrawal workflow reserves funds internally:

1. `POST /api/v1/payments/withdrawals` validates KYC, limits, and that no fee is
   configured, then debits the wallet and credits
   `PLATFORM:WITHDRAWAL_RESERVED` in one balanced entry. Status is `PENDING`.
2. `GET /api/v1/payments/withdrawals/{reference}` returns the owner's withdrawal.
3. `POST /api/v1/payments/withdrawals/{reference}/cancel` reverses the reservation
   and sets `CANCELLED`. Repeating the cancel is idempotent.

Missing integration: Chapa's adapter has no payout capability and the service does
not fabricate an external payout or a `COMPLETED` state. Completing withdrawals
requires a payout-capable provider, payout webhooks/settlement reconciliation, a
defined `PENDING → COMPLETED` transition tied to provider evidence, and fee
accounting for payouts. Until then, withdrawals with a non-zero configured fee are
rejected with `WITHDRAWAL_FEE_UNSUPPORTED`.

## 10. Database integrity controls

The migration adds checks and triggers so application bugs cannot silently produce
invalid accounting:

- `JournalEntry_must_balance` (deferred): minimum two postings, debit = credit,
  same currency.
- `LedgerPosting_apply_balance`: maintains account balances using each account's
  normal side.
- `LedgerPosting_wallet_projection` and `Wallet_balance_matches_ledger` (deferred):
  wallet and ledger balances must agree at commit.
- `JournalEntry_immutable`, `LedgerPosting_immutable`,
  `TransactionReversal_immutable`: no UPDATE/DELETE of posted ledger records.
- `Transaction_financial_immutability`: financial fields cannot change; reversal
  totals and status must agree.
- `TransactionReversal_consistent` (deferred): reversal rows must sum to
  `reversedAmount`.
- `Payment_completed_requires_ledger` (deferred): a payment cannot become
  `COMPLETED` without a transaction and journal entry.
- `Wallet_create_ledger_account`: every new wallet gets a liability account.

Check constraints reject non-positive posting amounts, invalid statuses, invalid
currencies, negative fees, and reversed amounts above the transaction amount.

## 11. Migration and existing data

Migration: `prisma/migrations/20261028120000_double_entry_ledger`.

What it does:

1. Adds transaction lifecycle/currency/fee/reversal/business-date/policy columns.
2. Marks every pre-existing transaction `LEGACY`. Historical rows are **not**
   reinterpreted as ledger entries and have no journal entries.
3. Creates ledger, policy, withdrawal, and reconciliation tables plus the
   platform accounts.
4. Creates one ledger account per wallet and one `OPENING_BALANCE` entry for each
   wallet whose pre-migration balance was greater than zero, using that recorded
   balance as the source. Each entry carries migration provenance metadata and a
   unique `eventRef` (`wallet:<id>`).
5. Seeds `TRANSFER`/`DEPOSIT`/`WITHDRAWAL` ETB policies and their initial revision
   rows.

No historical transaction is converted into a confirmed ledger posting, and no
balancing entry is invented to force totals. The opening equity account is the
counterpart for the liability snapshot.

### Procedure for an existing database

1. Take a verified backup (`pg_dump`) and record wallet balances and row counts.
2. Restore the backup into a disposable database and apply migrations there first.
3. Run `npm run ledger:verify` against the disposable copy and compare wallet
   balances before/after; opening entries must equal the recorded balances.
4. Apply the additive migration during a low-traffic window. In this repository,
   the `user-migrate` compose service runs `prisma migrate deploy`; it should not
   be pointed at a production database without the backup/verification steps.
5. Run `npm run ledger:verify` again against the migrated database.
6. Treat `LEGACY` rows as history only. Corrections to pre-ledger history require
   manual review; they cannot be posted as ledger reversals.

### Verification evidence (disposable database)

A `user_phase3_legacy` database was created with the three pre-ledger migrations
and representative data: three users, wallets of 100.00 / 25.50 / 40.00, one
legacy transfer, one legacy `COMPLETED` deposit, and one `PENDING` deposit. After
applying the ledger migration:

- Wallet balances were unchanged and matched their ledger accounts.
- Both transactions were `LEGACY` with no journal entries.
- The legacy completed payment remained `COMPLETED`; the pending payment remained
  `PENDING`.
- Three opening entries were created with 165.50 debit and 165.50 credit in total.
- Platform accounts and policies were seeded; opening equity was -165.50.
- `npm run ledger:verify` passed. Changing one `LEGACY` row to `POSTED` without a
  journal entry made it fail with `transaction-missing-entry`, proving the
  provenance check works; restoring `LEGACY` made it pass again.

### Rollback and recovery

The ledger tables are immutable by trigger, so an in-place down-migration is not
supported. Recovery is restore-from-backup, or an explicitly reviewed script that
disables/drops the ledger triggers, tables, and added columns. Do not delete
journal entries or post compensating entries to hide a problem; preserve evidence
and restore from backup instead.

## 12. Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `RECONCILIATION_ENABLED` | `false` | Start the in-process reconciliation interval |
| `RECONCILIATION_INTERVAL_MS` | `300000` | Interval between scheduled runs (1s–24h) |
| `RECONCILIATION_STALE_MINUTES` | `15` | Minimum age of a pending payment (1 min–7 days) |
| `RECONCILIATION_BATCH_SIZE` | `25` | Maximum payments per run (1–500) |
| `CHAPA_SECRET_KEY` | empty | Chapa Test Mode private key (`CHAPA_TEST_...`); empty disables deposits |
| `CHAPA_WEBHOOK_SECRET` | empty | HMAC secret for webhook signatures (16+ chars when Chapa is configured) |
| `CHAPA_BASE_URL` | `https://api.chapa.global` | Provider API base |
| `CHAPA_CALLBACK_URL` | empty | Provider webhook URL (HTTPS outside development) |
| `CHAPA_RETURN_URL` | empty | Frontend return URL after checkout |
| `AUTH_MODE` | `dev` | `jwt` is required for real deployments; `dev` is rejected in production |
| `KYC_SERVICE_URL`, `INTERNAL_SERVICE_KEY` | empty | KYC eligibility lookup used by financial routes |

## 13. API and OpenAPI

The OpenAPI document at `docs/openapi.json` (served at `GET /api/v1/openapi.json`
when docs are enabled, with Swagger UI at `/docs`) documents:

- `POST /api/v1/transactions/{reference}/reversals` (ADMIN)
- `POST /api/v1/payments/withdrawals`, `GET /api/v1/payments/withdrawals/{reference}`,
  `POST /api/v1/payments/withdrawals/{reference}/cancel`
- `POST /api/v1/payments/deposits/{reference}/refunds` (ADMIN, fails closed 501)
- `GET /api/v1/admin/financial-policies`,
  `PATCH /api/v1/admin/financial-policies/{type}` (ADMIN)
- `POST /api/v1/admin/payments/reconciliation` (ADMIN)

Roles come from the verified session/JWT only; request bodies cannot elevate a
role.

## 14. Testing

Prerequisites: an isolated PostgreSQL database whose name ends in `_test`.

```bash
export WALLET_TEST_DATABASE_URL='postgresql://auth:auth@localhost:5432/user_phase3_test?schema=public'
npm run test:phase3      # wallets, payments, ledger, policies — sequential
npm run test:ledger
npm run test:policies
npm run test:payments
npm run test:wallets
npm run ledger:verify    # DATABASE_URL=... against the target database
```

Coverage includes exact minor-unit arithmetic, balanced/unbalanced posting
rejection, duplicate event references, immutable posted rows, wallet/ledger
projection drift, concurrent transfers and overdraw, duplicate webhook delivery,
deposit verification and mismatch handling, provider success plus local ledger
failure recovery, stale reconciliation, admin-only reversals (partial/full,
idempotent, duplicate, over-reversal, legacy rejection), concurrent daily limits,
fee calculation and fee revenue reversal, withdrawal reserve/cancel, KYC/authz,
and migration/legacy provenance.

The Phase 3 suites leave immutable ledger fixtures in the disposable test
database; suites cannot delete posted entries by design. Use a dedicated test
database per run.

## 15. Remaining risks and production review

- **Not production-ready.** The development authentication mode, in-process
  scheduler, single-currency assumptions, and test-mode provider integration are
  prototype scope.
- `PLATFORM:PROVIDER_CLEARING` is a receivable, not verified cash. There is no
  bank/settlement feed, so the platform cannot prove that provider-held funds match
  the ledger.
- No payout provider: withdrawals can only be reserved and cancelled. Never treat
  a reservation as a completed withdrawal.
- Legacy rows have no ledger provenance and cannot be reversed through the ledger.
  Historical disputes need manual review and a documented adjustment policy.
- Reconciliation is best-effort and in-process. Multiple replicas may all call the
  provider; idempotency prevents double credit, but provider rate limits and
  duplicate calls need operational review.
- Partial reversals refund fees only when the transaction is fully reversed.
- Policy defaults and limit values are prototype parameters; a compliance review
  is required before real use. The platform makes no regulatory claims.
- Superusers who can disable triggers or write directly to the database can
  violate the invariants; production should restrict direct database access.
- No FX, chargeback, dispute, or settlement workflow; no interest, statements, or
  ledger archival/retention policy.
- KYC eligibility depends on `kyc-service` availability; financial routes fail
  closed if eligibility cannot be confirmed.
