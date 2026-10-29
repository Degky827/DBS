-- Phase 3: double-entry ledger, immutable postings, reversals, policies,
-- reconciliation records, and the internal withdrawal reservation lifecycle.
--
-- Existing wallet balances are the only reliable pre-ledger record. This
-- migration snapshots them into opening journal entries. Historical
-- Transaction rows are marked LEGACY and are never reinterpreted as verified
-- ledger postings.

-- ---------------------------------------------------------------------------
-- Extend Transaction with lifecycle, currency, fee, reversal, and policy data
-- ---------------------------------------------------------------------------
ALTER TABLE "Transaction"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'POSTED',
    ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    ADD COLUMN "feeAmount" DECIMAL(19,2) NOT NULL DEFAULT 0,
    ADD COLUMN "reversedAmount" DECIMAL(19,2) NOT NULL DEFAULT 0,
    ADD COLUMN "businessDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN "policySnapshot" JSONB;

ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_status_check"
        CHECK ("status" IN ('POSTED', 'PARTIALLY_REVERSED', 'REVERSED', 'LEGACY')),
    ADD CONSTRAINT "Transaction_currency_check"
        CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "Transaction_fee_nonnegative_check"
        CHECK ("feeAmount" >= 0),
    ADD CONSTRAINT "Transaction_reversed_bounds_check"
        CHECK ("reversedAmount" >= 0 AND "reversedAmount" <= "amount");

-- Everything that existed before the ledger is a historical record, not a
-- confirmed ledger entry.
UPDATE "Transaction" SET "status" = 'LEGACY';

-- ---------------------------------------------------------------------------
-- Ledger tables
-- ---------------------------------------------------------------------------
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "normalBalance" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "walletId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "balance" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerAccount_type_check"
        CHECK ("type" IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    CONSTRAINT "LedgerAccount_normal_balance_check"
        CHECK ("normalBalance" IN ('DEBIT', 'CREDIT')),
    CONSTRAINT "LedgerAccount_normal_balance_matches_type_check" CHECK (
        ("type" = 'ASSET' AND "normalBalance" = 'DEBIT') OR
        ("type" = 'EXPENSE' AND "normalBalance" = 'DEBIT') OR
        ("type" IN ('LIABILITY', 'EQUITY', 'REVENUE') AND "normalBalance" = 'CREDIT')
    ),
    CONSTRAINT "LedgerAccount_wallet_shape_check" CHECK (
        ("walletId" IS NULL) OR
        ("walletId" IS NOT NULL AND "type" = 'LIABILITY' AND "normalBalance" = 'CREDIT')
    ),
    CONSTRAINT "LedgerAccount_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");
CREATE UNIQUE INDEX "LedgerAccount_walletId_key" ON "LedgerAccount"("walletId");
CREATE INDEX "LedgerAccount_type_idx" ON "LedgerAccount"("type");
CREATE INDEX "LedgerAccount_currency_idx" ON "LedgerAccount"("currency");

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "currency" VARCHAR(3) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT,
    "transactionId" TEXT,
    "withdrawalId" TEXT,
    "reversalOfId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JournalEntry_status_check" CHECK ("status" = 'POSTED'),
    CONSTRAINT "JournalEntry_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "JournalEntry_event_ref_present_check" CHECK (length("eventRef") > 0)
);

CREATE UNIQUE INDEX "JournalEntry_reference_key" ON "JournalEntry"("reference");
CREATE UNIQUE INDEX "JournalEntry_eventType_eventRef_key"
    ON "JournalEntry"("eventType", "eventRef");
CREATE UNIQUE INDEX "JournalEntry_transactionId_key" ON "JournalEntry"("transactionId");
CREATE UNIQUE INDEX "JournalEntry_withdrawalId_key" ON "JournalEntry"("withdrawalId");
CREATE INDEX "JournalEntry_reversalOfId_idx" ON "JournalEntry"("reversalOfId");
CREATE INDEX "JournalEntry_eventRef_idx" ON "JournalEntry"("eventRef");
CREATE INDEX "JournalEntry_currency_postedAt_idx" ON "JournalEntry"("currency", "postedAt");

CREATE TABLE "LedgerPosting" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerPosting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LedgerPosting_direction_check" CHECK ("direction" IN ('DEBIT', 'CREDIT')),
    CONSTRAINT "LedgerPosting_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "LedgerPosting_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "LedgerPosting_entry_account_direction_key"
    ON "LedgerPosting"("journalEntryId", "ledgerAccountId", "direction");
CREATE INDEX "LedgerPosting_ledgerAccountId_createdAt_idx"
    ON "LedgerPosting"("ledgerAccountId", "createdAt");
CREATE INDEX "LedgerPosting_journalEntryId_idx" ON "LedgerPosting"("journalEntryId");

CREATE TABLE "TransactionReversal" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionReversal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TransactionReversal_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "TransactionReversal_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "TransactionReversal_reason_present_check" CHECK (length(btrim("reason")) > 0)
);

CREATE UNIQUE INDEX "TransactionReversal_reference_key" ON "TransactionReversal"("reference");
CREATE UNIQUE INDEX "TransactionReversal_journalEntryId_key"
    ON "TransactionReversal"("journalEntryId");
CREATE UNIQUE INDEX "TransactionReversal_transactionId_idempotencyKey_key"
    ON "TransactionReversal"("transactionId", "idempotencyKey");
CREATE INDEX "TransactionReversal_transactionId_createdAt_idx"
    ON "TransactionReversal"("transactionId", "createdAt");

CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "businessDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Withdrawal_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "Withdrawal_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    -- COMPLETED is deliberately absent: no payout provider is integrated.
    CONSTRAINT "Withdrawal_status_check" CHECK ("status" IN ('PENDING', 'CANCELLED'))
);

CREATE UNIQUE INDEX "Withdrawal_reference_key" ON "Withdrawal"("reference");
CREATE UNIQUE INDEX "Withdrawal_userId_idempotencyKey_key"
    ON "Withdrawal"("userId", "idempotencyKey");
CREATE INDEX "Withdrawal_walletId_createdAt_idx" ON "Withdrawal"("walletId", "createdAt");
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

CREATE TABLE "FinancialPolicy" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "minAmount" DECIMAL(19,2) NOT NULL,
    "maxAmount" DECIMAL(19,2) NOT NULL,
    "dailyOutgoingAmount" DECIMAL(19,2) NOT NULL,
    "dailyOutgoingCount" INTEGER NOT NULL,
    "feeType" TEXT NOT NULL DEFAULT 'NONE',
    "feeFlat" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "feeBps" INTEGER NOT NULL DEFAULT 0,
    "feeMin" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "feeMax" DECIMAL(19,2),
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialPolicy_type_check"
        CHECK ("type" IN ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL')),
    CONSTRAINT "FinancialPolicy_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "FinancialPolicy_amounts_check" CHECK (
        "minAmount" > 0 AND "maxAmount" >= "minAmount" AND
        "dailyOutgoingAmount" >= 0 AND "dailyOutgoingCount" >= 0
    ),
    CONSTRAINT "FinancialPolicy_fee_check" CHECK (
        "feeType" IN ('NONE', 'FLAT', 'PERCENTAGE', 'FLAT_PLUS_PERCENTAGE') AND
        "feeFlat" >= 0 AND "feeBps" >= 0 AND "feeBps" <= 10000 AND
        "feeMin" >= 0 AND ("feeMax" IS NULL OR "feeMax" >= "feeMin")
    )
);

CREATE UNIQUE INDEX "FinancialPolicy_type_currency_key"
    ON "FinancialPolicy"("type", "currency");
CREATE INDEX "FinancialPolicy_type_currency_isActive_idx"
    ON "FinancialPolicy"("type", "currency", "isActive");

CREATE TABLE "FinancialPolicyRevision" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialPolicyRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialPolicyRevision_reason_present_check"
        CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "FinancialPolicyRevision_policyId_createdAt_idx"
    ON "FinancialPolicyRevision"("policyId", "createdAt");

CREATE TABLE "PaymentReconciliationRecord" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "providerStatus" TEXT,
    "providerRef" TEXT,
    "providerAmount" DECIMAL(19,2),
    "providerCurrency" VARCHAR(3),
    "outcome" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReconciliationRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentReconciliationRecord_attempt_positive_check" CHECK ("attempt" > 0),
    CONSTRAINT "PaymentReconciliationRecord_outcome_check" CHECK (
        "outcome" IN ('MATCHED', 'PENDING', 'MISMATCH', 'ERROR', 'MANUAL_REVIEW')
    )
);

CREATE INDEX "PaymentReconciliationRecord_paymentId_createdAt_idx"
    ON "PaymentReconciliationRecord"("paymentId", "createdAt");
CREATE INDEX "PaymentReconciliationRecord_outcome_idx"
    ON "PaymentReconciliationRecord"("outcome");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "LedgerAccount"
    ADD CONSTRAINT "LedgerAccount_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_withdrawalId_fkey"
    FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry"
    ADD CONSTRAINT "JournalEntry_reversalOfId_fkey"
    FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerPosting"
    ADD CONSTRAINT "LedgerPosting_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerPosting"
    ADD CONSTRAINT "LedgerPosting_ledgerAccountId_fkey"
    FOREIGN KEY ("ledgerAccountId") REFERENCES "LedgerAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TransactionReversal"
    ADD CONSTRAINT "TransactionReversal_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransactionReversal"
    ADD CONSTRAINT "TransactionReversal_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Withdrawal"
    ADD CONSTRAINT "Withdrawal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserProfile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Withdrawal"
    ADD CONSTRAINT "Withdrawal_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialPolicyRevision"
    ADD CONSTRAINT "FinancialPolicyRevision_policyId_fkey"
    FOREIGN KEY ("policyId") REFERENCES "FinancialPolicy"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentReconciliationRecord"
    ADD CONSTRAINT "PaymentReconciliationRecord_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Platform accounts
-- ---------------------------------------------------------------------------
INSERT INTO "LedgerAccount"
    ("id", "code", "name", "type", "normalBalance", "currency", "walletId", "isActive", "balance", "createdAt", "updatedAt")
VALUES
    ('00000000-0000-4000-8000-000000000101', 'PLATFORM:PROVIDER_CLEARING',
     'Amounts receivable from the payment provider for confirmed deposits',
     'ASSET', 'DEBIT', 'ETB', NULL, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000102', 'PLATFORM:FEE_REVENUE',
     'Fee revenue collected from customers', 'REVENUE', 'CREDIT', 'ETB', NULL, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000103', 'PLATFORM:OPENING_BALANCE',
     'Equity offset for opening wallet liabilities', 'EQUITY', 'CREDIT', 'ETB', NULL, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000104', 'PLATFORM:WITHDRAWAL_RESERVED',
     'Customer funds reserved for withdrawal requests', 'LIABILITY', 'CREDIT', 'ETB', NULL, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Triggers and integrity functions
-- ---------------------------------------------------------------------------

-- Every posting adjusts its account balance using the account's normal side.
CREATE OR REPLACE FUNCTION ledger_apply_posting() RETURNS trigger AS $$
DECLARE
    account RECORD;
    delta DECIMAL(19,2);
BEGIN
    SELECT "id", "normalBalance" INTO account
    FROM "LedgerAccount" WHERE "id" = NEW."ledgerAccountId" FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ledger account % does not exist', NEW."ledgerAccountId";
    END IF;

    IF account."normalBalance" = 'DEBIT' THEN
        delta := CASE WHEN NEW."direction" = 'DEBIT' THEN NEW."amount" ELSE -NEW."amount" END;
    ELSE
        delta := CASE WHEN NEW."direction" = 'CREDIT' THEN NEW."amount" ELSE -NEW."amount" END;
    END IF;

    UPDATE "LedgerAccount"
    SET "balance" = "balance" + delta, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = account."id";

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerPosting_apply_balance"
    AFTER INSERT ON "LedgerPosting"
    FOR EACH ROW EXECUTE FUNCTION ledger_apply_posting();

-- Posted ledger records are immutable. Corrections use reversal entries.
CREATE OR REPLACE FUNCTION ledger_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Posted ledger records are immutable; post a reversal entry instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalEntry_immutable"
    BEFORE UPDATE OR DELETE ON "JournalEntry"
    FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();
CREATE TRIGGER "LedgerPosting_immutable"
    BEFORE UPDATE OR DELETE ON "LedgerPosting"
    FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();
CREATE TRIGGER "TransactionReversal_immutable"
    BEFORE UPDATE OR DELETE ON "TransactionReversal"
    FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();

-- A posted entry must contain at least two postings, in the entry currency,
-- with debit and credit totals exactly equal. Deferred so it can inspect the
-- complete entry at commit time.
CREATE OR REPLACE FUNCTION ledger_assert_entry_balanced() RETURNS trigger AS $$
DECLARE
    entry RECORD;
    posting_count INTEGER;
    debit_total DECIMAL(19,2);
    credit_total DECIMAL(19,2);
    mismatched_currency INTEGER;
BEGIN
    SELECT * INTO entry FROM "JournalEntry" WHERE "id" = NEW."journalEntryId";
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COUNT(*),
           COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN "currency" <> entry."currency" THEN 1 ELSE 0 END), 0)
    INTO posting_count, debit_total, credit_total, mismatched_currency
    FROM "LedgerPosting"
    WHERE "journalEntryId" = NEW."journalEntryId";

    IF posting_count < 2 THEN
        RAISE EXCEPTION 'Journal entry % needs at least two postings', NEW."journalEntryId";
    END IF;
    IF debit_total <> credit_total THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: debit % credit %',
            NEW."journalEntryId", debit_total, credit_total;
    END IF;
    IF mismatched_currency > 0 THEN
        RAISE EXCEPTION 'Journal entry % has postings in a different currency',
            NEW."journalEntryId";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "JournalEntry_must_balance"
    AFTER INSERT ON "LedgerPosting"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_assert_entry_balanced();

-- Wallet.balance is a projection of the wallet's liability account. The
-- deferred check catches any divergence before commit.
CREATE OR REPLACE FUNCTION ledger_assert_wallet_projection() RETURNS trigger AS $$
DECLARE
    account_balance DECIMAL(19,2);
    wallet_balance DECIMAL(19,2);
BEGIN
    SELECT ledger."balance", wallet."balance"
    INTO account_balance, wallet_balance
    FROM "LedgerPosting" posting
    JOIN "LedgerAccount" ledger ON ledger."id" = posting."ledgerAccountId"
    JOIN "Wallet" wallet ON wallet."id" = ledger."walletId"
    WHERE posting."id" = NEW."id";

    IF FOUND AND account_balance <> wallet_balance THEN
        RAISE EXCEPTION 'Wallet projection % does not match ledger balance %',
            wallet_balance, account_balance;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LedgerPosting_wallet_projection"
    AFTER INSERT ON "LedgerPosting"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_assert_wallet_projection();

CREATE OR REPLACE FUNCTION wallet_assert_balance_matches_ledger() RETURNS trigger AS $$
DECLARE
    account_balance DECIMAL(19,2);
BEGIN
    SELECT "balance" INTO account_balance
    FROM "LedgerAccount" WHERE "walletId" = NEW."id";

    IF FOUND AND account_balance <> NEW."balance" THEN
        RAISE EXCEPTION 'Wallet balance % does not match ledger balance %',
            NEW."balance", account_balance;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Wallet_balance_matches_ledger"
    AFTER UPDATE OF "balance" ON "Wallet"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION wallet_assert_balance_matches_ledger();

-- New wallets automatically receive a liability ledger account.
CREATE OR REPLACE FUNCTION wallet_create_ledger_account() RETURNS trigger AS $$
BEGIN
    INSERT INTO "LedgerAccount"
        ("id", "code", "name", "type", "normalBalance", "currency", "walletId",
         "isActive", "balance", "createdAt", "updatedAt")
    VALUES
        (gen_random_uuid()::text, 'WALLET:' || NEW."id", 'Customer wallet ' || NEW."id",
         'LIABILITY', 'CREDIT', NEW."currency", NEW."id", TRUE, 0,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Wallet_create_ledger_account"
    AFTER INSERT ON "Wallet"
    FOR EACH ROW EXECUTE FUNCTION wallet_create_ledger_account();

-- Financial fields of a transaction never change after it is written.
CREATE OR REPLACE FUNCTION transaction_assert_financial_immutability() RETURNS trigger AS $$
DECLARE
    reversal_total DECIMAL(19,2);
BEGIN
    IF NEW."reference" <> OLD."reference" OR
       NEW."initiatedByUserId" <> OLD."initiatedByUserId" OR
       NEW."type" <> OLD."type" OR
       NEW."sourceWalletId" IS DISTINCT FROM OLD."sourceWalletId" OR
       NEW."destinationWalletId" <> OLD."destinationWalletId" OR
       NEW."amount" <> OLD."amount" OR
       NEW."feeAmount" <> OLD."feeAmount" OR
       NEW."currency" <> OLD."currency" OR
       NEW."businessDate" <> OLD."businessDate" OR
       NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR
       NEW."idempotencyKey" <> OLD."idempotencyKey" THEN
        RAISE EXCEPTION 'Financial fields of transaction % are immutable', OLD."id";
    END IF;

    IF NEW."reversedAmount" <> OLD."reversedAmount" THEN
        SELECT COALESCE(SUM("amount"), 0) INTO reversal_total
        FROM "TransactionReversal" WHERE "transactionId" = NEW."id";

        IF reversal_total <> NEW."reversedAmount" THEN
            RAISE EXCEPTION 'Transaction % reversed amount does not match reversals',
                NEW."id";
        END IF;
        IF NEW."reversedAmount" > NEW."amount" THEN
            RAISE EXCEPTION 'Transaction % reversal exceeds amount', NEW."id";
        END IF;
        IF NEW."reversedAmount" = NEW."amount" AND NEW."status" <> 'REVERSED' THEN
            RAISE EXCEPTION 'Transaction % must be REVERSED when fully reversed', NEW."id";
        END IF;
        IF NEW."reversedAmount" > 0 AND NEW."reversedAmount" < NEW."amount"
           AND NEW."status" <> 'PARTIALLY_REVERSED' THEN
            RAISE EXCEPTION 'Transaction % must be PARTIALLY_REVERSED', NEW."id";
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_financial_immutability"
    BEFORE UPDATE ON "Transaction"
    FOR EACH ROW EXECUTE FUNCTION transaction_assert_financial_immutability();

CREATE OR REPLACE FUNCTION transaction_assert_reversal_consistency() RETURNS trigger AS $$
DECLARE
    transaction_row RECORD;
    reversal_total DECIMAL(19,2);
BEGIN
    SELECT * INTO transaction_row FROM "Transaction" WHERE "id" = NEW."transactionId";
    SELECT COALESCE(SUM("amount"), 0) INTO reversal_total
    FROM "TransactionReversal" WHERE "transactionId" = NEW."transactionId";

    IF reversal_total <> transaction_row."reversedAmount" THEN
        RAISE EXCEPTION 'Transaction % reversal total does not match reversed amount',
            NEW."transactionId";
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "TransactionReversal_consistent"
    AFTER INSERT ON "TransactionReversal"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION transaction_assert_reversal_consistency();

-- A payment may only become COMPLETED together with a ledger-backed
-- transaction in the same database transaction. Pre-ledger completed rows are
-- not retroactively reinterpreted.
CREATE OR REPLACE FUNCTION payment_assert_completed_ledger() RETURNS trigger AS $$
BEGIN
    IF NEW."status" = 'COMPLETED'
       AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'COMPLETED') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "Transaction" transaction_row
            JOIN "JournalEntry" entry ON entry."transactionId" = transaction_row."id"
            WHERE transaction_row."paymentId" = NEW."id"
        ) THEN
            RAISE EXCEPTION 'Payment % cannot be COMPLETED without a ledger entry', NEW."id";
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Payment_completed_requires_ledger"
    AFTER INSERT OR UPDATE ON "Payment"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION payment_assert_completed_ledger();

-- ---------------------------------------------------------------------------
-- Opening balances from the pre-ledger wallet snapshot
-- ---------------------------------------------------------------------------
INSERT INTO "LedgerAccount"
    ("id", "code", "name", "type", "normalBalance", "currency", "walletId",
     "isActive", "balance", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'WALLET:' || wallet."id",
    'Customer wallet ' || wallet."id",
    'LIABILITY',
    'CREDIT',
    wallet."currency",
    wallet."id",
    TRUE,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Wallet" wallet
ON CONFLICT ("code") DO NOTHING;

DO $$
DECLARE
    wallet_row RECORD;
    entry_id TEXT;
    opening_account_id TEXT;
BEGIN
    SELECT "id" INTO opening_account_id
    FROM "LedgerAccount" WHERE "code" = 'PLATFORM:OPENING_BALANCE';

    FOR wallet_row IN SELECT * FROM "Wallet" WHERE "balance" > 0 LOOP
        entry_id := gen_random_uuid()::text;

        INSERT INTO "JournalEntry"
            ("id", "reference", "eventType", "eventRef", "status", "currency",
             "description", "metadata", "createdByUserId", "postedAt", "createdAt")
        VALUES
            (entry_id,
             'JRN-OPEN-' || replace(gen_random_uuid()::text, '-', ''),
             'OPENING_BALANCE',
             'wallet:' || wallet_row."id",
             'POSTED',
             wallet_row."currency",
             'Opening balance from pre-ledger wallet snapshot',
             jsonb_build_object(
                 'source', 'Wallet.balance at ledger migration',
                 'migration', '20261028120000_double_entry_ledger',
                 'walletId', wallet_row."id"
             ),
             NULL,
             CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP);

        INSERT INTO "LedgerPosting"
            ("id", "journalEntryId", "ledgerAccountId", "direction", "amount", "currency", "createdAt")
        VALUES
            (gen_random_uuid()::text, entry_id, opening_account_id, 'DEBIT',
             wallet_row."balance", wallet_row."currency", CURRENT_TIMESTAMP),
            (gen_random_uuid()::text, entry_id,
             (SELECT "id" FROM "LedgerAccount" WHERE "walletId" = wallet_row."id"),
             'CREDIT', wallet_row."balance", wallet_row."currency", CURRENT_TIMESTAMP);
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Initial policies (reviewed through this migration; runtime changes are
-- ADMIN-only and write a revision row)
-- ---------------------------------------------------------------------------
INSERT INTO "FinancialPolicy"
    ("id", "type", "currency", "minAmount", "maxAmount", "dailyOutgoingAmount",
     "dailyOutgoingCount", "feeType", "feeFlat", "feeBps", "feeMin", "feeMax",
     "timezone", "isActive", "effectiveFrom", "createdBy", "createdAt", "updatedAt")
VALUES
    ('00000000-0000-4000-8000-000000000201', 'TRANSFER', 'ETB',
     0.01, 1000000.00, 500000.00, 100, 'NONE', 0, 0, 0, NULL,
     'Africa/Addis_Ababa', TRUE, CURRENT_TIMESTAMP, 'migration',
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000202', 'DEPOSIT', 'ETB',
     1.00, 1000000.00, 2000000.00, 100, 'NONE', 0, 0, 0, NULL,
     'Africa/Addis_Ababa', TRUE, CURRENT_TIMESTAMP, 'migration',
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-000000000203', 'WITHDRAWAL', 'ETB',
     1.00, 100000.00, 200000.00, 20, 'NONE', 0, 0, 0, NULL,
     'Africa/Addis_Ababa', TRUE, CURRENT_TIMESTAMP, 'migration',
     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "currency") DO NOTHING;

INSERT INTO "FinancialPolicyRevision" ("id", "policyId", "changedBy", "reason", "snapshot")
SELECT
    gen_random_uuid()::text,
    policy."id",
    'migration',
    'Initial Phase 3 financial policy',
    to_jsonb(policy)
FROM "FinancialPolicy" policy
WHERE NOT EXISTS (
    SELECT 1 FROM "FinancialPolicyRevision" revision
    WHERE revision."policyId" = policy."id"
);
