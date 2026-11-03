-- Phase 4: scheduled ledger verification jobs, fraud detection and
-- investigation workflow, and the external payout pipeline.
--
-- The tables below are generated from the Prisma model; the integrity rules at
-- the end of this file are hand-written because they encode the promises the
-- financial code depends on: a payout is never SUCCESS without a settlement
-- journal entry, an investigation trail is append-only, and a risk score can
-- never be recorded outside its band.
--
-- Seeded fraud rules and thresholds are sample configuration for development.
-- They demonstrate the workflow; they are not a validated AML or fraud
-- programme and must be reviewed by a risk function before real use.

-- DropIndex
DROP INDEX "Payment_status_idx";

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "businessDate" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "businessDate" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Withdrawal" ALTER COLUMN "businessDate" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "LedgerVerificationRun" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "checksRun" INTEGER NOT NULL DEFAULT 0,
    "entriesChecked" INTEGER NOT NULL DEFAULT 0,
    "accountsChecked" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB,
    "summary" JSONB,
    "errorMessage" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerVerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerVerificationIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "accountCode" TEXT,
    "expected" DECIMAL(19,2),
    "actual" DECIMAL(19,2),
    "difference" DECIMAL(19,2),
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerVerificationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "signal" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "points" INTEGER NOT NULL DEFAULT 10,
    "riskWeight" INTEGER NOT NULL DEFAULT 1,
    "windowMinutes" INTEGER,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "generatesAlert" BOOLEAN NOT NULL DEFAULT true,
    "recommendsHold" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudRuleRevision" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudRuleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSignal" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "subjectHash" TEXT,
    "ipHash" TEXT,
    "deviceFingerprintHash" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRiskAssessment" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',
    "thresholds" JSONB,
    "engineVersion" TEXT NOT NULL DEFAULT 'v1',
    "alertsGenerated" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionRiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "userId" TEXT,
    "walletId" TEXT,
    "transactionId" TEXT,
    "ruleCode" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'RULE_ENGINE',
    "riskLevel" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "evidence" JSONB,
    "amount" DECIMAL(19,2),
    "currency" VARCHAR(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedToUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCase" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedBy" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closureReason" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCaseAlert" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudCaseAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCaseNote" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudCaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudWatchlistEntry" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL,
    "label" TEXT,
    "reason" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "removedBy" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "FraudWatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "beneficiaryId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "providerPayoutId" TEXT,
    "destinationAccount" TEXT NOT NULL,
    "destinationName" TEXT,
    "destinationCode" TEXT,
    "amount" DECIMAL(19,2) NOT NULL,
    "feeAmount" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "tierCode" TEXT,
    "policySnapshot" JSONB,
    "riskScore" INTEGER,
    "screeningRef" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "reversalReason" TEXT,
    "settlementEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAttempt" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'INITIAL',
    "provider" TEXT NOT NULL,
    "providerStatus" TEXT,
    "providerRef" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "details" JSONB,

    CONSTRAINT "PayoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutWebhookEvent" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "payoutId" TEXT,
    "payoutReference" TEXT,
    "provider" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "remoteAddressHash" TEXT,
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutReconciliationRecord" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "providerStatus" TEXT,
    "providerRef" TEXT,
    "providerAmount" DECIMAL(19,2),
    "providerCurrency" VARCHAR(3),
    "outcome" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerVerificationRun_reference_key" ON "LedgerVerificationRun"("reference");

-- CreateIndex
CREATE INDEX "LedgerVerificationRun_status_startedAt_idx" ON "LedgerVerificationRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "LedgerVerificationRun_startedAt_idx" ON "LedgerVerificationRun"("startedAt");

-- CreateIndex
CREATE INDEX "LedgerVerificationIssue_runId_idx" ON "LedgerVerificationIssue"("runId");

-- CreateIndex
CREATE INDEX "LedgerVerificationIssue_status_severity_idx" ON "LedgerVerificationIssue"("status", "severity");

-- CreateIndex
CREATE INDEX "LedgerVerificationIssue_classification_aggregateId_idx" ON "LedgerVerificationIssue"("classification", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "FraudRule_code_key" ON "FraudRule"("code");

-- CreateIndex
CREATE INDEX "FraudRule_isActive_signal_idx" ON "FraudRule"("isActive", "signal");

-- CreateIndex
CREATE INDEX "FraudRuleRevision_ruleId_createdAt_idx" ON "FraudRuleRevision"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FraudSignal_dedupeKey_key" ON "FraudSignal"("dedupeKey");

-- CreateIndex
CREATE INDEX "FraudSignal_userId_occurredAt_idx" ON "FraudSignal"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "FraudSignal_type_occurredAt_idx" ON "FraudSignal"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "FraudSignal_deviceFingerprintHash_occurredAt_idx" ON "FraudSignal"("deviceFingerprintHash", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionRiskAssessment_transactionId_key" ON "TransactionRiskAssessment"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionRiskAssessment_riskLevel_createdAt_idx" ON "TransactionRiskAssessment"("riskLevel", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionRiskAssessment_userId_createdAt_idx" ON "TransactionRiskAssessment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FraudAlert_reference_key" ON "FraudAlert"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FraudAlert_dedupeKey_key" ON "FraudAlert"("dedupeKey");

-- CreateIndex
CREATE INDEX "FraudAlert_status_openedAt_idx" ON "FraudAlert"("status", "openedAt");

-- CreateIndex
CREATE INDEX "FraudAlert_userId_openedAt_idx" ON "FraudAlert"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "FraudAlert_riskLevel_openedAt_idx" ON "FraudAlert"("riskLevel", "openedAt");

-- CreateIndex
CREATE INDEX "FraudAlert_ruleCode_openedAt_idx" ON "FraudAlert"("ruleCode", "openedAt");

-- CreateIndex
CREATE INDEX "FraudAlert_transactionId_idx" ON "FraudAlert"("transactionId");

-- CreateIndex
CREATE INDEX "FraudAlertEvent_alertId_createdAt_idx" ON "FraudAlertEvent"("alertId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FraudCase_reference_key" ON "FraudCase"("reference");

-- CreateIndex
CREATE INDEX "FraudCase_status_openedAt_idx" ON "FraudCase"("status", "openedAt");

-- CreateIndex
CREATE INDEX "FraudCase_assignedToUserId_status_idx" ON "FraudCase"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "FraudCaseAlert_alertId_idx" ON "FraudCaseAlert"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "FraudCaseAlert_caseId_alertId_key" ON "FraudCaseAlert"("caseId", "alertId");

-- CreateIndex
CREATE INDEX "FraudCaseNote_caseId_createdAt_idx" ON "FraudCaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "FraudWatchlistEntry_targetType_targetRef_idx" ON "FraudWatchlistEntry"("targetType", "targetRef");

-- CreateIndex
CREATE INDEX "FraudWatchlistEntry_isActive_expiresAt_idx" ON "FraudWatchlistEntry"("isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_withdrawalId_key" ON "Payout"("withdrawalId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_providerPayoutId_key" ON "Payout"("providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_settlementEntryId_key" ON "Payout"("settlementEntryId");

-- CreateIndex
CREATE INDEX "Payout_status_requestedAt_idx" ON "Payout"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Payout_userId_requestedAt_idx" ON "Payout"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "Payout_provider_status_idx" ON "Payout"("provider", "status");

-- CreateIndex
CREATE INDEX "Payout_walletId_createdAt_idx" ON "Payout"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_userId_idempotencyKey_key" ON "Payout"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PayoutAttempt_payoutId_startedAt_idx" ON "PayoutAttempt"("payoutId", "startedAt");

-- CreateIndex
CREATE INDEX "PayoutAttempt_outcome_startedAt_idx" ON "PayoutAttempt"("outcome", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAttempt_payoutId_attempt_key" ON "PayoutAttempt"("payoutId", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutWebhookEvent_bodyHash_key" ON "PayoutWebhookEvent"("bodyHash");

-- CreateIndex
CREATE INDEX "PayoutWebhookEvent_payoutReference_receivedAt_idx" ON "PayoutWebhookEvent"("payoutReference", "receivedAt");

-- CreateIndex
CREATE INDEX "PayoutWebhookEvent_payoutId_receivedAt_idx" ON "PayoutWebhookEvent"("payoutId", "receivedAt");

-- CreateIndex
CREATE INDEX "PayoutReconciliationRecord_payoutId_createdAt_idx" ON "PayoutReconciliationRecord"("payoutId", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutReconciliationRecord_outcome_idx" ON "PayoutReconciliationRecord"("outcome");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_initiatedByUserId_businessDate_status_idx" ON "Transaction"("initiatedByUserId", "businessDate", "status");

-- AddForeignKey
ALTER TABLE "LedgerVerificationIssue" ADD CONSTRAINT "LedgerVerificationIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LedgerVerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudRuleRevision" ADD CONSTRAINT "FraudRuleRevision_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FraudRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRiskAssessment" ADD CONSTRAINT "TransactionRiskAssessment_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudAlertEvent" ADD CONSTRAINT "FraudAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "FraudAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCaseAlert" ADD CONSTRAINT "FraudCaseAlert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FraudCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCaseAlert" ADD CONSTRAINT "FraudCaseAlert_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "FraudAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCaseNote" ADD CONSTRAINT "FraudCaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "FraudCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "Beneficiary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_settlementEntryId_fkey" FOREIGN KEY ("settlementEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAttempt" ADD CONSTRAINT "PayoutAttempt_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutWebhookEvent" ADD CONSTRAINT "PayoutWebhookEvent_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReconciliationRecord" ADD CONSTRAINT "PayoutReconciliationRecord_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "LedgerPosting_entry_account_direction_key" RENAME TO "LedgerPosting_journalEntryId_ledgerAccountId_direction_key";

-- ---------------------------------------------------------------------------
-- Withdrawal reservation lifecycle extended for payouts
--
-- PENDING and CANCELLED keep their Phase 3 meaning. PROCESSING, SETTLED and
-- FAILED are only reached by the payout workflow, once the reservation has been
-- handed to (or returned by) an external provider.
-- ---------------------------------------------------------------------------
ALTER TABLE "Withdrawal"
    DROP CONSTRAINT "Withdrawal_status_check",
    ADD CONSTRAINT "Withdrawal_status_check" CHECK (
        "status" IN ('PENDING', 'PROCESSING', 'SETTLED', 'CANCELLED', 'FAILED')
    );

-- ---------------------------------------------------------------------------
-- Ledger verification job integrity
-- ---------------------------------------------------------------------------
ALTER TABLE "LedgerVerificationRun"
    ADD CONSTRAINT "LedgerVerificationRun_trigger_check"
        CHECK ("trigger" IN ('SCHEDULED', 'MANUAL', 'CI')),
    ADD CONSTRAINT "LedgerVerificationRun_status_check"
        CHECK ("status" IN ('RUNNING', 'PASSED', 'FAILED', 'ERROR')),
    ADD CONSTRAINT "LedgerVerificationRun_counters_check" CHECK (
        "checksRun" >= 0 AND "entriesChecked" >= 0
        AND "accountsChecked" >= 0 AND "issuesFound" >= 0
    ),
    ADD CONSTRAINT "LedgerVerificationRun_duration_check" CHECK (
        "durationMs" IS NULL OR "durationMs" >= 0
    ),
    ADD CONSTRAINT "LedgerVerificationRun_finished_check" CHECK (
        ("status" = 'RUNNING') = ("finishedAt" IS NULL)
    ),
    ADD CONSTRAINT "LedgerVerificationRun_finished_order_check" CHECK (
        "finishedAt" IS NULL OR "finishedAt" >= "startedAt"
    ),
    ADD CONSTRAINT "LedgerVerificationRun_error_check" CHECK (
        "status" <> 'ERROR' OR length(btrim(coalesce("errorMessage", ''))) > 0
    ),
    ADD CONSTRAINT "LedgerVerificationRun_totals_json_check" CHECK (
        "totals" IS NULL OR jsonb_typeof("totals") = 'object'
    );

ALTER TABLE "LedgerVerificationIssue"
    ADD CONSTRAINT "LedgerVerificationIssue_severity_check"
        CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    ADD CONSTRAINT "LedgerVerificationIssue_status_check"
        CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
    ADD CONSTRAINT "LedgerVerificationIssue_classification_check"
        CHECK ("classification" ~ '^[A-Z][A-Z0-9_]{2,59}$'),
    ADD CONSTRAINT "LedgerVerificationIssue_target_check" CHECK (
        length(btrim("aggregateType")) > 0 AND length(btrim("aggregateId")) > 0
    ),
    ADD CONSTRAINT "LedgerVerificationIssue_difference_check" CHECK (
        "expected" IS NULL OR "actual" IS NULL OR "difference" IS NULL
        OR "difference" = "actual" - "expected"
    ),
    ADD CONSTRAINT "LedgerVerificationIssue_resolution_check" CHECK (
        "status" <> 'RESOLVED'
        OR ("resolvedBy" IS NOT NULL AND length(btrim(coalesce("resolutionNote", ''))) > 0)
    ),
    ADD CONSTRAINT "LedgerVerificationIssue_resolution_order_check" CHECK (
        "resolvedAt" IS NULL OR "resolvedAt" >= "detectedAt"
    );

-- ---------------------------------------------------------------------------
-- Fraud detection integrity
-- ---------------------------------------------------------------------------
ALTER TABLE "FraudRule"
    ADD CONSTRAINT "FraudRule_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{2,59}$'),
    ADD CONSTRAINT "FraudRule_signal_check" CHECK (
        "signal" IN ('TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'PAYOUT', 'LOGIN', 'DEVICE', 'BENEFICIARY', 'SCHEDULED_TRANSFER', 'ACCOUNT')
    ),
    ADD CONSTRAINT "FraudRule_points_check" CHECK ("points" BETWEEN 0 AND 100),
    ADD CONSTRAINT "FraudRule_weight_check" CHECK ("riskWeight" BETWEEN 0 AND 10),
    ADD CONSTRAINT "FraudRule_window_check" CHECK (
        "windowMinutes" IS NULL OR "windowMinutes" BETWEEN 1 AND 10080
    ),
    ADD CONSTRAINT "FraudRule_cooldown_check" CHECK (
        "cooldownMinutes" BETWEEN 0 AND 10080
    ),
    ADD CONSTRAINT "FraudRule_version_check" CHECK ("version" >= 1),
    ADD CONSTRAINT "FraudRule_params_check" CHECK (jsonb_typeof("params") = 'object');

ALTER TABLE "FraudRuleRevision"
    ADD CONSTRAINT "FraudRuleRevision_reason_check"
        CHECK (length(btrim("reason")) > 0),
    ADD CONSTRAINT "FraudRuleRevision_snapshot_check"
        CHECK (jsonb_typeof("snapshot") = 'object');

ALTER TABLE "FraudSignal"
    ADD CONSTRAINT "FraudSignal_type_check" CHECK (
        "type" IN ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'NEW_DEVICE',
                   'UNRECOGNISED_DEVICE', 'MFA_FAILURE', 'PASSWORD_CHANGE',
                   'PASSWORD_RESET', 'SESSION_REVOKED')
    ),
    ADD CONSTRAINT "FraudSignal_subject_check" CHECK (
        "userId" IS NOT NULL OR "subjectHash" IS NOT NULL
    ),
    ADD CONSTRAINT "FraudSignal_subject_hash_check" CHECK (
        "subjectHash" IS NULL OR "subjectHash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "FraudSignal_ip_hash_check" CHECK (
        "ipHash" IS NULL OR "ipHash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "FraudSignal_fingerprint_hash_check" CHECK (
        "deviceFingerprintHash" IS NULL OR "deviceFingerprintHash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "FraudSignal_payload_check" CHECK (
        "payload" IS NULL OR jsonb_typeof("payload") = 'object'
    );

ALTER TABLE "TransactionRiskAssessment"
    ADD CONSTRAINT "TransactionRiskAssessment_score_check" CHECK ("score" BETWEEN 0 AND 1000),
    ADD CONSTRAINT "TransactionRiskAssessment_level_check"
        CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    ADD CONSTRAINT "TransactionRiskAssessment_factors_check"
        CHECK (jsonb_typeof("factors") = 'array'),
    ADD CONSTRAINT "TransactionRiskAssessment_thresholds_check" CHECK (
        "thresholds" IS NULL OR jsonb_typeof("thresholds") = 'object'
    ),
    ADD CONSTRAINT "TransactionRiskAssessment_alerts_check" CHECK ("alertsGenerated" >= 0);

ALTER TABLE "FraudAlert"
    ADD CONSTRAINT "FraudAlert_status_check" CHECK (
        "status" IN ('NEW', 'UNDER_REVIEW', 'CONFIRMED', 'FALSE_POSITIVE', 'RESOLVED')
    ),
    ADD CONSTRAINT "FraudAlert_level_check"
        CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    ADD CONSTRAINT "FraudAlert_source_check"
        CHECK ("source" IN ('RULE_ENGINE', 'MANUAL', 'SCREENING', 'LEDGER', 'AUTH')),
    ADD CONSTRAINT "FraudAlert_score_check" CHECK ("score" BETWEEN 0 AND 1000),
    ADD CONSTRAINT "FraudAlert_rule_code_check" CHECK ("ruleCode" ~ '^[A-Z][A-Z0-9_]{2,59}$'),
    ADD CONSTRAINT "FraudAlert_title_check" CHECK (
        length(btrim("title")) BETWEEN 1 AND 200
    ),
    ADD CONSTRAINT "FraudAlert_amount_check" CHECK (
        "amount" IS NULL OR "amount" > 0
    ),
    ADD CONSTRAINT "FraudAlert_currency_check" CHECK (
        "currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'
    ),
    ADD CONSTRAINT "FraudAlert_evidence_check" CHECK (
        "evidence" IS NULL OR jsonb_typeof("evidence") = 'object'
    ),
    -- An alert is closed by a named person with a stated reason. Fraud monitoring
    -- never self-closes, and never labels a customer as guilty.
    ADD CONSTRAINT "FraudAlert_resolution_check" CHECK (
        "status" IN ('NEW', 'UNDER_REVIEW')
        OR ("resolvedBy" IS NOT NULL AND length(btrim(coalesce("resolution", ''))) > 0)
    ),
    ADD CONSTRAINT "FraudAlert_resolution_order_check" CHECK (
        "resolvedAt" IS NULL OR "resolvedAt" >= "openedAt"
    );

ALTER TABLE "FraudAlertEvent"
    ADD CONSTRAINT "FraudAlertEvent_type_check"
        CHECK ("type" ~ '^[A-Z][A-Z0-9_]{2,59}$'),
    ADD CONSTRAINT "FraudAlertEvent_payload_check" CHECK (
        "payload" IS NULL OR jsonb_typeof("payload") = 'object'
    );

ALTER TABLE "FraudCase"
    ADD CONSTRAINT "FraudCase_status_check" CHECK (
        "status" IN ('OPEN', 'UNDER_INVESTIGATION', 'PENDING_INFORMATION', 'ESCALATED', 'CLOSED')
    ),
    ADD CONSTRAINT "FraudCase_level_check"
        CHECK ("riskLevel" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    ADD CONSTRAINT "FraudCase_title_check" CHECK (
        length(btrim("title")) BETWEEN 1 AND 200
    ),
    ADD CONSTRAINT "FraudCase_closed_check" CHECK (
        ("status" = 'CLOSED'
            AND "closedAt" IS NOT NULL
            AND "outcome" IN ('TRUE_POSITIVE', 'FALSE_POSITIVE', 'ACTION_TAKEN', 'NO_ACTION')
            AND length(btrim(coalesce("closureReason", ''))) > 0)
        OR ("status" <> 'CLOSED' AND "closedAt" IS NULL AND "outcome" IS NULL)
    );

ALTER TABLE "FraudCaseNote"
    ADD CONSTRAINT "FraudCaseNote_body_check"
        CHECK (length(btrim("body")) BETWEEN 1 AND 4000);

ALTER TABLE "FraudWatchlistEntry"
    ADD CONSTRAINT "FraudWatchlistEntry_target_type_check" CHECK (
        "targetType" IN ('WALLET_ID', 'USER_ID', 'ACCOUNT_NUMBER', 'PHONE', 'BENEFICIARY_ID', 'DEVICE_FINGERPRINT_HASH')
    ),
    ADD CONSTRAINT "FraudWatchlistEntry_target_ref_check" CHECK (
        length(btrim("targetRef")) BETWEEN 1 AND 120
    ),
    ADD CONSTRAINT "FraudWatchlistEntry_reason_check"
        CHECK (length(btrim("reason")) > 0),
    ADD CONSTRAINT "FraudWatchlistEntry_state_check" CHECK (
        ("isActive" AND "removedAt" IS NULL)
        OR (NOT "isActive" AND "removedAt" IS NOT NULL AND "removedBy" IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- Payout integrity
--
-- The two rules that matter most are here: SUCCESS cannot be recorded without
-- the settlement journal entry that proves the money left the reserved account,
-- and a request is unique per customer idempotency key.
-- ---------------------------------------------------------------------------
ALTER TABLE "Payout"
    ADD CONSTRAINT "Payout_status_check"
        CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED')),
    ADD CONSTRAINT "Payout_amount_check" CHECK (
        "amount" > 0 AND "feeAmount" >= 0
    ),
    ADD CONSTRAINT "Payout_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "Payout_provider_check" CHECK (
        length(btrim("provider")) BETWEEN 1 AND 40
    ),
    ADD CONSTRAINT "Payout_destination_check" CHECK (
        length(btrim("destinationAccount")) BETWEEN 1 AND 80
    ),
    ADD CONSTRAINT "Payout_idempotency_key_check" CHECK (
        length(btrim("idempotencyKey")) > 0
    ),
    ADD CONSTRAINT "Payout_risk_score_check" CHECK (
        "riskScore" IS NULL OR "riskScore" BETWEEN 0 AND 1000
    ),
    ADD CONSTRAINT "Payout_sent_check" CHECK (
        "status" NOT IN ('PROCESSING', 'SUCCESS') OR "sentAt" IS NOT NULL
    ),
    ADD CONSTRAINT "Payout_terminal_reason_check" CHECK (
        "status" NOT IN ('FAILED', 'REVERSED')
        OR length(btrim(coalesce("failureReason", "reversalReason", ''))) > 0
    ),
    ADD CONSTRAINT "Payout_reversed_check" CHECK (
        "reversedAt" IS NULL OR ("status" = 'REVERSED' AND "reversedAt" >= "requestedAt")
    ),
    ADD CONSTRAINT "Payout_timestamp_order_check" CHECK (
        ("sentAt" IS NULL OR "sentAt" >= "requestedAt")
        AND ("completedAt" IS NULL OR "completedAt" >= "requestedAt")
    ),
    ADD CONSTRAINT "Payout_policy_snapshot_check" CHECK (
        "policySnapshot" IS NULL OR jsonb_typeof("policySnapshot") = 'object'
    );

ALTER TABLE "PayoutAttempt"
    ADD CONSTRAINT "PayoutAttempt_attempt_check" CHECK ("attempt" >= 1),
    ADD CONSTRAINT "PayoutAttempt_trigger_check" CHECK (
        "trigger" IN ('INITIAL', 'RETRY', 'WEBHOOK', 'RECONCILIATION')
    ),
    ADD CONSTRAINT "PayoutAttempt_outcome_check" CHECK (
        "outcome" IN ('SUCCESS', 'FAILED', 'REJECTED', 'TIMEOUT', 'UNKNOWN')
    ),
    ADD CONSTRAINT "PayoutAttempt_http_check" CHECK (
        "httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599
    ),
    ADD CONSTRAINT "PayoutAttempt_latency_check" CHECK (
        "latencyMs" IS NULL OR "latencyMs" >= 0
    ),
    ADD CONSTRAINT "PayoutAttempt_order_check" CHECK (
        "finishedAt" IS NULL OR "finishedAt" >= "startedAt"
    ),
    -- A timed-out or unreadable response must say why it is unresolved.
    ADD CONSTRAINT "PayoutAttempt_unknown_reason_check" CHECK (
        "outcome" NOT IN ('TIMEOUT', 'UNKNOWN')
        OR length(btrim(coalesce("errorCode", "errorMessage", ''))) > 0
    );

ALTER TABLE "PayoutWebhookEvent"
    ADD CONSTRAINT "PayoutWebhookEvent_provider_check" CHECK (
        length(btrim("provider")) BETWEEN 1 AND 40
    ),
    ADD CONSTRAINT "PayoutWebhookEvent_event_check" CHECK (
        length(btrim("event")) > 0
    ),
    ADD CONSTRAINT "PayoutWebhookEvent_ip_hash_check" CHECK (
        "remoteAddressHash" IS NULL OR "remoteAddressHash" ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT "PayoutWebhookEvent_payload_check" CHECK (
        "payload" IS NULL OR jsonb_typeof("payload") = 'object'
    ),
    ADD CONSTRAINT "PayoutWebhookEvent_order_check" CHECK (
        "processedAt" IS NULL OR "processedAt" >= "receivedAt"
    );

ALTER TABLE "PayoutReconciliationRecord"
    ADD CONSTRAINT "PayoutReconciliationRecord_attempt_check" CHECK ("attempt" >= 1),
    ADD CONSTRAINT "PayoutReconciliationRecord_trigger_check" CHECK (
        "trigger" IN ('SCHEDULED', 'MANUAL', 'WEBHOOK', 'CI')
    ),
    ADD CONSTRAINT "PayoutReconciliationRecord_outcome_check" CHECK (
        "outcome" IN ('MATCHED', 'MISMATCH', 'PROVIDER_PENDING', 'PROVIDER_FAILED', 'PROVIDER_UNKNOWN', 'NO_PROVIDER_REF', 'REPAIRED')
    ),
    ADD CONSTRAINT "PayoutReconciliationRecord_amount_check" CHECK (
        "providerAmount" IS NULL OR "providerAmount" > 0
    ),
    ADD CONSTRAINT "PayoutReconciliationRecord_currency_check" CHECK (
        "providerCurrency" IS NULL OR "providerCurrency" ~ '^[A-Z]{3}$'
    ),
    ADD CONSTRAINT "PayoutReconciliationRecord_details_check" CHECK (
        "details" IS NULL OR length("details") <= 2000
    );

-- A payout may only be reported as delivered once the ledger says the reserved
-- money actually left. Deferred so the status flip and the settlement entry can
-- be written in either order inside one transaction, never committed apart.
CREATE OR REPLACE FUNCTION payout_assert_success_settled() RETURNS trigger AS $$
BEGIN
    IF NEW."status" = 'SUCCESS' AND NEW."settlementEntryId" IS NULL THEN
        RAISE EXCEPTION 'Payout % cannot be SUCCESS without its settlement journal entry', NEW."reference";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Payout_success_requires_settlement"
    AFTER INSERT OR UPDATE ON "Payout"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION payout_assert_success_settled();

-- ---------------------------------------------------------------------------
-- Partial uniqueness the data model cannot express
-- ---------------------------------------------------------------------------

-- Re-running the verifier must not create a second open record for the same
-- broken thing.
CREATE UNIQUE INDEX "ledger_verification_issue_one_open_per_target"
    ON "LedgerVerificationIssue" ("classification", "aggregateType", "aggregateId")
    WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');

-- A watchlist target can only be listed once at a time.
CREATE UNIQUE INDEX "fraud_watchlist_one_active_per_target"
    ON "FraudWatchlistEntry" ("targetType", "targetRef")
    WHERE "isActive";

-- One unfinished payout dispatch per (customer, idempotency key) is already
-- guaranteed; this guards the operator workflow instead: a customer may only
-- have one payout in flight to the same destination.
CREATE UNIQUE INDEX "payout_one_in_flight_per_destination"
    ON "Payout" ("userId", "destinationAccount")
    WHERE "status" IN ('PENDING', 'PROCESSING');

-- ---------------------------------------------------------------------------
-- Append-only investigation trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fraud_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Fraud investigation records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FraudAlertEvent_immutable"
    BEFORE UPDATE OR DELETE ON "FraudAlertEvent"
    FOR EACH ROW EXECUTE FUNCTION fraud_forbid_mutation();
CREATE TRIGGER "FraudCaseNote_immutable"
    BEFORE UPDATE OR DELETE ON "FraudCaseNote"
    FOR EACH ROW EXECUTE FUNCTION fraud_forbid_mutation();
CREATE TRIGGER "FraudRuleRevision_immutable"
    BEFORE UPDATE OR DELETE ON "FraudRuleRevision"
    FOR EACH ROW EXECUTE FUNCTION fraud_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Platform account used when a payout settles
--
-- Settlement moves reserved customer funds out of the platform:
--   DEBIT  PLATFORM:PAYOUT_SETTLEMENT   (asset, money disbursed)
--   CREDIT PLATFORM:WITHDRAWAL_RESERVED (liability released)
-- ---------------------------------------------------------------------------
INSERT INTO "LedgerAccount"
    ("id", "code", "name", "type", "normalBalance", "currency", "walletId",
     "isActive", "balance", "createdAt", "updatedAt")
VALUES
    ('00000000-0000-4000-8000-000000000105', 'PLATFORM:PAYOUT_SETTLEMENT',
     'Funds disbursed to external payout providers on settlement',
     'ASSET', 'DEBIT', 'ETB', NULL, TRUE, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Sample fraud rules (development defaults, operator-editable)
--
-- These weights are illustrative. They are not tuned against real loss data and
-- must be reviewed before the platform relies on them.
-- ---------------------------------------------------------------------------
INSERT INTO "FraudRule"
    ("id", "code", "name", "description", "signal", "params", "points", "riskWeight",
     "windowMinutes", "cooldownMinutes", "generatesAlert", "recommendsHold",
     "version", "isActive", "effectiveFrom", "createdAt", "updatedAt")
VALUES
    ('fraud-rule-large-transfer', 'LARGE_TRANSFER',
     'Transfer far above the customer''s normal size',
     'Flags a transfer that is a multiple of the customer''s recent median, or above an absolute floor.',
     'TRANSFER',
     '{"multipleOfMedian": 5, "minimumAbsolute": 50000, "lookbackDays": 30}',
     30, 2, NULL, 60, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-rapid-transfers', 'RAPID_SUCCESSIVE_TRANSFERS',
     'Several transfers in a short window',
     'Counts posted transfers by the same user inside the window.',
     'TRANSFER',
     '{"count": 3}',
     25, 2, 10, 30, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-watchlist-destination', 'WATCHLIST_DESTINATION',
     'Transfer to a watched account',
     'Raised when the destination wallet, beneficiary or account number is on the watchlist.',
     'BENEFICIARY',
     '{}',
     45, 3, NULL, 15, true, true, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-repeated-failures', 'REPEATED_FAILED_PAYMENTS',
     'Repeated failed deposits or withdrawals',
     'Counts failed provider interactions by the same user inside the window.',
     'DEPOSIT',
     '{"failures": 3}',
     20, 1, 15, 60, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-new-device', 'NEW_DEVICE_ACTIVITY',
     'Financial action from an unseen device',
     'Raised when a transaction follows a login from a device fingerprint never seen for this customer.',
     'DEVICE',
     '{"maxSessionMinutes": 30}',
     20, 1, NULL, 120, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-login-burst', 'LOGIN_FAILURE_BURST',
     'Burst of failed authentications',
     'Raised after a burst of failed logins for one identity or from one address.',
     'LOGIN',
     '{"failures": 5}',
     25, 2, 10, 30, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-abnormal-pattern', 'ABNORMAL_TRANSFER_PATTERN',
     'Transfer pattern outside the customer''s history',
     'Compares amount, cadence and destination count against the trailing window.',
     'TRANSFER',
     '{"deviationSigma": 3, "lookbackDays": 60}',
     35, 2, 60, 120, true, false, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fraud-rule-payout-after-tier-change', 'PAYOUT_TIER_CHANGE',
     'Payout shortly after a verification tier upgrade',
     'Newly upgraded tiers are a common escalation path; review before disbursing.',
     'PAYOUT',
     '{"withinMinutes": 60}',
     40, 3, 60, 120, true, true, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
