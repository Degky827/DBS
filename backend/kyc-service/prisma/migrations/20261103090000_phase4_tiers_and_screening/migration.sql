-- Phase 4: KYC tiers and periodic re-verification, AML/sanctions screening,
-- and the kyc-service transactional outbox.
--
-- Everything in the "sample configuration" section at the bottom is operator
-- data, not a regulatory template. The bundled sanctions source is a mock with
-- obviously fictional test rows: nothing in this migration asserts coverage of
-- any real-world sanctions list, and the service must never present these rows
-- as authoritative.

-- ---------------------------------------------------------------------------
-- Tier definitions and limits
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "KycDocument" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "expiryNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "KycSubmission" ADD COLUMN     "tierAssignedAt" TIMESTAMP(3),
ADD COLUMN     "tierAssignedBy" TEXT,
ADD COLUMN     "tierId" TEXT;

-- CreateTable
CREATE TABLE "KycTierDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minimumDocuments" INTEGER NOT NULL DEFAULT 1,
    "requiresLiveness" BOOLEAN NOT NULL DEFAULT false,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "requiredDocumentTypes" JSONB NOT NULL DEFAULT '[]',
    "allowedOperations" JSONB NOT NULL DEFAULT '[]',
    "reviewIntervalDays" INTEGER,
    "approvalValidDays" INTEGER,
    "reVerificationLeadDays" INTEGER NOT NULL DEFAULT 30,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycTierDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycTierDefinition_code_check"
        CHECK ("code" ~ '^TIER_[0-9]+$'),
    CONSTRAINT "KycTierDefinition_name_present_check"
        CHECK (length(btrim("name")) > 0),
    CONSTRAINT "KycTierDefinition_documents_check"
        CHECK ("minimumDocuments" >= 1 AND "minimumDocuments" <= 20),
    CONSTRAINT "KycTierDefinition_review_interval_check" CHECK (
        "reviewIntervalDays" IS NULL OR "reviewIntervalDays" BETWEEN 1 AND 3650
    ),
    CONSTRAINT "KycTierDefinition_approval_valid_check" CHECK (
        "approvalValidDays" IS NULL OR "approvalValidDays" BETWEEN 1 AND 3650
    ),
    CONSTRAINT "KycTierDefinition_lead_check"
        CHECK ("reVerificationLeadDays" BETWEEN 1 AND 365),
    CONSTRAINT "KycTierDefinition_version_check" CHECK ("version" >= 1),
    CONSTRAINT "KycTierDefinition_json_shape_check" CHECK (
        jsonb_typeof("requiredFields") = 'array'
        AND jsonb_typeof("requiredDocumentTypes") = 'array'
        AND jsonb_typeof("allowedOperations") = 'array'
    )
);

-- CreateTable
CREATE TABLE "KycTierLimit" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "minAmount" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "maxAmount" DECIMAL(19,2),
    "dailyAmount" DECIMAL(19,2),
    "dailyCount" INTEGER,
    "monthlyAmount" DECIMAL(19,2),
    "maxBalance" DECIMAL(19,2),
    "isAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycTierLimit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycTierLimit_operation_check" CHECK (
        "operation" IN ('DEPOSIT', 'TRANSFER', 'WITHDRAWAL', 'PAYOUT', 'SCHEDULED_TRANSFER')
    ),
    CONSTRAINT "KycTierLimit_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "KycTierLimit_amount_bounds_check" CHECK (
        "minAmount" >= 0
        AND ("maxAmount" IS NULL OR "maxAmount" >= "minAmount")
        AND ("dailyAmount" IS NULL OR "dailyAmount" > 0)
        AND ("monthlyAmount" IS NULL OR "monthlyAmount" > 0)
        AND ("maxBalance" IS NULL OR "maxBalance" > 0)
    ),
    CONSTRAINT "KycTierLimit_daily_count_check" CHECK (
        "dailyCount" IS NULL OR ("dailyCount" >= 0 AND "dailyCount" <= 100000)
    )
);

-- The tier a customer holds today is the newest APPROVED row; earlier rows stay
-- as history. KycSubmission.tierId is the separate immutable statement of what
-- a given batch of evidence qualified for.
-- CreateTable
CREATE TABLE "KycTierAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "submissionId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "reason" TEXT,
    "decisionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycTierAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycTierAssignment_direction_check"
        CHECK ("direction" IN ('INITIAL', 'UPGRADE', 'DOWNGRADE', 'MAINTENANCE')),
    CONSTRAINT "KycTierAssignment_status_check" CHECK (
        "status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')
    ),
    CONSTRAINT "KycTierAssignment_decision_check" CHECK (
        ("status" = 'REQUESTED' AND "decidedBy" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'REQUESTED' AND "decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL)
    ),
    CONSTRAINT "KycTierAssignment_reason_present_check" CHECK (
        "status" NOT IN ('REJECTED', 'CANCELLED') OR length(btrim(coalesce("decisionReason", ''))) > 0
    ),
    CONSTRAINT "KycTierAssignment_user_present_check" CHECK (length(btrim("userId")) > 0)
);

-- CreateTable
CREATE TABLE "KycReVerificationTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT,
    "submissionId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "waivedBy" TEXT,
    "waiverReason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycReVerificationTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycReVerificationTask_reason_check" CHECK (
        "reason" IN (
            'APPROVAL_EXPIRING', 'APPROVAL_EXPIRED', 'DOCUMENT_EXPIRING', 'DOCUMENT_EXPIRED',
            'PERIODIC_REVIEW', 'TIER_UPGRADE', 'SCREENING_FOLLOW_UP', 'REVOKED', 'MANUAL'
        )
    ),
    CONSTRAINT "KycReVerificationTask_status_check" CHECK (
        "status" IN ('OPEN', 'NOTIFIED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'OVERDUE', 'WAIVED', 'CANCELLED')
    ),
    CONSTRAINT "KycReVerificationTask_waiver_check" CHECK (
        "status" <> 'WAIVED'
        OR ("waivedBy" IS NOT NULL AND length(btrim(coalesce("waiverReason", ''))) > 0)
    )
);

-- ---------------------------------------------------------------------------
-- Sanctions list sources and entries
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "SanctionsListSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "uri" TEXT,
    "refreshIntervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAuthoritative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SanctionsListSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SanctionsListSource_code_check"
        CHECK ("code" ~ '^[A-Z0-9_-]{2,40}$'),
    CONSTRAINT "SanctionsListSource_provider_check" CHECK (
        "provider" IN ('MOCK', 'FILE', 'HTTP', 'COMMERCIAL')
    ),
    CONSTRAINT "SanctionsListSource_refresh_check"
        CHECK ("refreshIntervalMinutes" BETWEEN 1 AND 10080)
);

-- CreateTable
CREATE TABLE "SanctionsListEntry" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "country" TEXT,
    "dateOfBirth" TEXT,
    "idNumber" TEXT,
    "listVersion" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SanctionsListEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SanctionsListEntry_name_present_check" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "SanctionsListEntry_normalized_check" CHECK (
        "normalizedName" = upper(btrim("normalizedName"))
    ),
    CONSTRAINT "SanctionsListEntry_aliases_check"
        CHECK (jsonb_typeof("aliases") = 'array')
);

-- ---------------------------------------------------------------------------
-- Screening cases, decisions and event trail
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "ScreeningCase" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submissionId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subjectName" TEXT NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "subjectSnapshot" JSONB,
    "matches" JSONB NOT NULL DEFAULT '[]',
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "topScore" DOUBLE PRECISION,
    "engineVersion" TEXT NOT NULL DEFAULT 'v1',
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "listVersions" JSONB,
    "assignedToUserId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningCase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScreeningCase_status_check" CHECK (
        "status" IN ('PENDING', 'CLEAR', 'POTENTIAL_MATCH', 'CONFIRMED_MATCH', 'UNDER_REVIEW', 'CLEARED_AFTER_REVIEW')
    ),
    CONSTRAINT "ScreeningCase_trigger_check" CHECK (
        "triggeredBy" IN ('KYC_APPROVAL', 'PROFILE_CHANGE', 'PERIODIC', 'TIER_UPGRADE', 'MANUAL')
    ),
    CONSTRAINT "ScreeningCase_closed_check" CHECK (
        "closedAt" IS NULL
        OR "status" IN ('CLEAR', 'CLEARED_AFTER_REVIEW', 'CONFIRMED_MATCH')
    ),
    CONSTRAINT "ScreeningCase_subject_present_check" CHECK (length(btrim("subjectName")) > 0),
    CONSTRAINT "ScreeningCase_subject_normalized_check" CHECK (
        "subjectNormalized" = upper(btrim("subjectNormalized"))
    ),
    CONSTRAINT "ScreeningCase_matches_check"
        CHECK (jsonb_typeof("matches") = 'array'),
    CONSTRAINT "ScreeningCase_candidate_count_check" CHECK (
        "candidateCount" >= 0
        AND ("topScore" IS NULL OR ("topScore" >= 0 AND "topScore" <= 1))
    )
);

-- Append-only review trail: a decision is never edited in place, only followed
-- by another row, so the reviewer history reconstructs what was seen and said.
-- CreateTable
CREATE TABLE "ScreeningDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScreeningDecision_action_check" CHECK (
        "action" IN (
            'SCREENED', 'ASSIGNED', 'UNASSIGNED', 'STARTED_REVIEW', 'REQUESTED_INFORMATION',
            'CLEARED', 'ESCALATED', 'CONFIRMED_MATCH', 'REOPENED', 'NOTE', 'SCHEDULED_REVIEW'
        )
    ),
    CONSTRAINT "ScreeningDecision_actor_present_check"
        CHECK (length(btrim("actorId")) > 0),
    CONSTRAINT "ScreeningDecision_note_required_check" CHECK (
        "action" NOT IN ('CLEARED', 'ESCALATED', 'CONFIRMED_MATCH', 'REOPENED', 'REQUESTED_INFORMATION')
        OR length(btrim(coalesce("note", ''))) > 0
    )
);

-- CreateTable
CREATE TABLE "ScreeningEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreeningEvent_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- kyc-service outbox (mirrors user_db "OutboxEvent")
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "KycOutboxEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycTierDefinition_isActive_code_idx" ON "KycTierDefinition"("isActive", "code");

-- CreateIndex
CREATE UNIQUE INDEX "KycTierDefinition_code_version_key" ON "KycTierDefinition"("code", "version");

-- CreateIndex
CREATE INDEX "KycTierLimit_operation_currency_idx" ON "KycTierLimit"("operation", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "KycTierLimit_tierId_operation_currency_key" ON "KycTierLimit"("tierId", "operation", "currency");

-- CreateIndex
CREATE INDEX "KycTierAssignment_userId_status_requestedAt_idx" ON "KycTierAssignment"("userId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "KycTierAssignment_status_requestedAt_idx" ON "KycTierAssignment"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "KycTierAssignment_tierId_idx" ON "KycTierAssignment"("tierId");

-- CreateIndex
CREATE INDEX "KycReVerificationTask_status_dueAt_idx" ON "KycReVerificationTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "KycReVerificationTask_userId_idx" ON "KycReVerificationTask"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KycReVerificationTask_userId_reason_dueAt_key" ON "KycReVerificationTask"("userId", "reason", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SanctionsListSource_code_key" ON "SanctionsListSource"("code");

-- CreateIndex
CREATE INDEX "SanctionsListSource_isActive_idx" ON "SanctionsListSource"("isActive");

-- CreateIndex
CREATE INDEX "SanctionsListEntry_normalizedName_idx" ON "SanctionsListEntry"("normalizedName");

-- CreateIndex
CREATE INDEX "SanctionsListEntry_sourceId_removedAt_idx" ON "SanctionsListEntry"("sourceId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SanctionsListEntry_sourceId_externalId_listVersion_key" ON "SanctionsListEntry"("sourceId", "externalId", "listVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningCase_reference_key" ON "ScreeningCase"("reference");

-- CreateIndex
CREATE INDEX "ScreeningCase_status_openedAt_idx" ON "ScreeningCase"("status", "openedAt");

-- CreateIndex
CREATE INDEX "ScreeningCase_userId_openedAt_idx" ON "ScreeningCase"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "ScreeningCase_nextReviewAt_idx" ON "ScreeningCase"("nextReviewAt");

-- CreateIndex
CREATE INDEX "ScreeningCase_submissionId_idx" ON "ScreeningCase"("submissionId");

-- CreateIndex
CREATE INDEX "ScreeningDecision_caseId_createdAt_idx" ON "ScreeningDecision"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreeningEvent_caseId_createdAt_idx" ON "ScreeningEvent"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KycOutboxEvent_eventId_key" ON "KycOutboxEvent"("eventId");

-- CreateIndex
CREATE INDEX "KycOutboxEvent_publishedAt_nextAttemptAt_idx" ON "KycOutboxEvent"("publishedAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "KycOutboxEvent_aggregateType_aggregateId_idx" ON "KycOutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "KycOutboxEvent_type_occurredAt_idx" ON "KycOutboxEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "KycDocument_expiresAt_idx" ON "KycDocument"("expiresAt");

-- CreateIndex
CREATE INDEX "KycSubmission_tierId_idx" ON "KycSubmission"("tierId");

-- AddForeignKey
ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "KycTierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycTierLimit" ADD CONSTRAINT "KycTierLimit_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "KycTierDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycTierAssignment" ADD CONSTRAINT "KycTierAssignment_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "KycTierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycTierAssignment" ADD CONSTRAINT "KycTierAssignment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycReVerificationTask" ADD CONSTRAINT "KycReVerificationTask_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionsListEntry" ADD CONSTRAINT "SanctionsListEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SanctionsListSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningCase" ADD CONSTRAINT "ScreeningCase_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningDecision" ADD CONSTRAINT "ScreeningDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ScreeningCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningEvent" ADD CONSTRAINT "ScreeningEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ScreeningCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Partial uniqueness the data model cannot express
-- ---------------------------------------------------------------------------

-- One live definition per tier code; superseded versions stay readable.
CREATE UNIQUE INDEX "kyc_tier_definition_one_active_per_code"
    ON "KycTierDefinition" ("code")
    WHERE "isActive";

-- A customer can only have one in-flight tier request.
CREATE UNIQUE INDEX "kyc_tier_assignment_one_open_per_user"
    ON "KycTierAssignment" ("userId")
    WHERE "status" = 'REQUESTED';

-- One open re-verification task per reason; the sweep must not pile up work.
CREATE UNIQUE INDEX "kyc_reverification_one_open_per_user_reason"
    ON "KycReVerificationTask" ("userId", "reason")
    WHERE "status" IN ('OPEN', 'NOTIFIED', 'IN_PROGRESS', 'SUBMITTED', 'OVERDUE');

-- One live entry per provider id, across list versions.
CREATE UNIQUE INDEX "sanctions_list_entry_one_live_per_external_id"
    ON "SanctionsListEntry" ("sourceId", "externalId")
    WHERE "removedAt" IS NULL;

-- One unresolved screening case per customer, so reviewers never duplicate a
-- match investigation that is still open.
CREATE UNIQUE INDEX "screening_case_one_open_per_user"
    ON "ScreeningCase" ("userId")
    WHERE "status" IN ('PENDING', 'POTENTIAL_MATCH', 'UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- Append-only protection for the screening review trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION screening_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Screening review records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ScreeningDecision_immutable"
    BEFORE UPDATE OR DELETE ON "ScreeningDecision"
    FOR EACH ROW EXECUTE FUNCTION screening_forbid_mutation();
CREATE TRIGGER "ScreeningEvent_immutable"
    BEFORE UPDATE OR DELETE ON "ScreeningEvent"
    FOR EACH ROW EXECUTE FUNCTION screening_forbid_mutation();

-- ---------------------------------------------------------------------------
-- Sample configuration (operator-editable, NOT a regulatory template)
--
-- Limits below are placeholder values chosen so the workflow is testable. They
-- do not demonstrate compliance with any jurisdiction and must be replaced
-- before the platform handles real customer funds.
-- ---------------------------------------------------------------------------
INSERT INTO "KycTierDefinition"
    ("id", "code", "name", "description", "minimumDocuments", "requiresLiveness",
     "requiredFields", "requiredDocumentTypes", "allowedOperations",
     "reviewIntervalDays", "approvalValidDays", "reVerificationLeadDays",
     "version", "isActive", "effectiveFrom", "createdAt", "updatedAt")
VALUES
    ('tier-def-sample-tier-1', 'TIER_1', 'Basic verification',
     'Sample entry tier: single identity document, no liveness, no external payouts.',
     1, false,
     '["firstName", "lastName", "email", "phoneNumber", "dateOfBirth"]',
     '["national_id"]',
     '["DEPOSIT", "TRANSFER"]',
     730, 365, 30, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-def-sample-tier-2', 'TIER_2', 'Intermediate verification',
     'Sample mid tier: two document captures plus liveness; limited payouts.',
     2, true,
     '["firstName", "lastName", "email", "phoneNumber", "dateOfBirth", "address"]',
     '["national_id"]',
     '["DEPOSIT", "TRANSFER", "WITHDRAWAL", "SCHEDULED_TRANSFER", "PAYOUT"]',
     545, 365, 45, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-def-sample-tier-3', 'TIER_3', 'Advanced verification',
     'Sample high tier: passport plus liveness and annual review; highest limits.',
     2, true,
     '["firstName", "lastName", "email", "phoneNumber", "dateOfBirth", "address", "occupation", "sourceOfFunds"]',
     '["passport"]',
     '["DEPOSIT", "TRANSFER", "WITHDRAWAL", "SCHEDULED_TRANSFER", "PAYOUT"]',
     365, 365, 60, 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code", "version") DO NOTHING;

INSERT INTO "KycTierLimit"
    ("id", "tierId", "operation", "currency", "minAmount", "maxAmount",
     "dailyAmount", "dailyCount", "monthlyAmount", "maxBalance", "isAllowed",
     "createdAt", "updatedAt")
VALUES
    ('tier-lim-t1-deposit',   'tier-def-sample-tier-1', 'DEPOSIT',           'ETB', 0, 5000.00,   10000.00,  5,   20000.00,  25000.00,  true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t1-transfer',  'tier-def-sample-tier-1', 'TRANSFER',          'ETB', 0, 5000.00,   10000.00,  5,   20000.00,  25000.00,  true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t1-withdraw',  'tier-def-sample-tier-1', 'WITHDRAWAL',        'ETB', 0, NULL,      NULL,      NULL,  NULL,     NULL,       false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t1-schedule',  'tier-def-sample-tier-1', 'SCHEDULED_TRANSFER','ETB', 0, NULL,      NULL,      NULL,  NULL,     NULL,       false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t1-payout',    'tier-def-sample-tier-1', 'PAYOUT',            'ETB', 0, NULL,      NULL,      NULL,  NULL,     NULL,       false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t2-deposit',   'tier-def-sample-tier-2', 'DEPOSIT',           'ETB', 0, 25000.00,  50000.00,  20,  200000.00, 250000.00, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t2-transfer',  'tier-def-sample-tier-2', 'TRANSFER',          'ETB', 0, 25000.00,  50000.00,  20,  200000.00, 250000.00, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t2-withdraw',  'tier-def-sample-tier-2', 'WITHDRAWAL',        'ETB', 0, 25000.00,  50000.00,  10,  200000.00, 250000.00, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t2-schedule',  'tier-def-sample-tier-2', 'SCHEDULED_TRANSFER','ETB', 0, 25000.00,  50000.00,  10,  200000.00, 250000.00, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t2-payout',    'tier-def-sample-tier-2', 'PAYOUT',            'ETB', 0, 10000.00,  20000.00,  5,   50000.00,  NULL,       true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t3-deposit',   'tier-def-sample-tier-3', 'DEPOSIT',           'ETB', 0, 100000.00, 250000.00, 50,  1000000.00, 2000000.00, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t3-transfer',  'tier-def-sample-tier-3', 'TRANSFER',          'ETB', 0, 100000.00, 250000.00, 50,  1000000.00, 2000000.00, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t3-withdraw',  'tier-def-sample-tier-3', 'WITHDRAWAL',        'ETB', 0, 100000.00, 250000.00, 25,  1000000.00, 2000000.00, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t3-schedule',  'tier-def-sample-tier-3', 'SCHEDULED_TRANSFER','ETB', 0, 100000.00, 250000.00, 25,  1000000.00, 2000000.00, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('tier-lim-t3-payout',    'tier-def-sample-tier-3', 'PAYOUT',            'ETB', 0, 50000.00,  100000.00, 20,  250000.00,  NULL,       true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("tierId", "operation", "currency") DO NOTHING;

-- Mock sanctions source. isAuthoritative is FALSE and the rows are fictional
-- test fixtures used only to exercise the match/review workflow in development.
-- A real deployment points a FILE/HTTP/COMMERCIAL provider at an actual list.
INSERT INTO "SanctionsListSource"
    ("id", "code", "name", "provider", "uri", "refreshIntervalMinutes",
     "isActive", "isAuthoritative", "createdAt", "updatedAt")
VALUES
    ('sanc-src-mock-demo', 'MOCK_DEMO', 'Mock demonstration list (not a real sanctions list)',
     'MOCK', NULL, 1440, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "SanctionsListEntry"
    ("id", "sourceId", "externalId", "name", "normalizedName", "aliases",
     "country", "dateOfBirth", "idNumber", "listVersion", "addedAt")
VALUES
    ('sanc-ent-mock-1', 'sanc-src-mock-demo', 'MOCK-TEST-001', 'TEST SUBJECT ALPHA',
     'TEST SUBJECT ALPHA', '["ALPHA TEST SUBJECT", "T. S. ALPHA"]',
     'XX', '1970-01-01', 'MOCK-ID-0001', 'mock-v1', CURRENT_TIMESTAMP),
    ('sanc-ent-mock-2', 'sanc-src-mock-demo', 'MOCK-TEST-002', 'FAKE ENTITY BRAVO',
     'FAKE ENTITY BRAVO', '["BRAVO ENTITY", "F. ENTITY BRAVO"]',
     'XX', NULL, 'MOCK-ID-0002', 'mock-v1', CURRENT_TIMESTAMP),
    ('sanc-ent-mock-3', 'sanc-src-mock-demo', 'MOCK-TEST-003', 'SAMPLE PERSON CHARLIE',
     'SAMPLE PERSON CHARLIE', '["CHARLIE SAMPLE"]',
     'XX', '1985-06-15', 'MOCK-ID-0003', 'mock-v1', CURRENT_TIMESTAMP)
ON CONFLICT ("sourceId", "externalId", "listVersion") DO NOTHING;
