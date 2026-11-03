-- Phase 4: login and device history. The fraud module needs an evidence base
-- for "unusual login" and "unrecognised device" signals; today authentication
-- writes no history at all.
--
-- Every identifying column is a SHA-256 hex digest and the CHECK constraints
-- below enforce that, so a buggy or malicious writer cannot deposit raw IPs,
-- fingerprints or typed identifiers into this table.

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "identifierHash" TEXT,
    "ipHash" TEXT,
    "ipPrefix" TEXT,
    "userAgent" TEXT,
    "deviceFingerprintHash" TEXT,
    "mfaMethod" TEXT,
    "failureReason" TEXT,
    "correlationId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LoginEvent_type_check" CHECK (
        "type" IN ('LOGIN', 'MFA', 'LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'TOKEN_REUSE', 'SESSION_REVOKED')
    ),
    CONSTRAINT "LoginEvent_outcome_check"
        CHECK ("outcome" IN ('SUCCESS', 'FAILURE', 'BLOCKED')),
    CONSTRAINT "LoginEvent_identifier_hash_check" CHECK (
        "identifierHash" IS NULL OR "identifierHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "LoginEvent_ip_hash_check" CHECK (
        "ipHash" IS NULL OR "ipHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "LoginEvent_fingerprint_hash_check" CHECK (
        "deviceFingerprintHash" IS NULL OR "deviceFingerprintHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "LoginEvent_prefix_length_check" CHECK (
        "ipPrefix" IS NULL OR length("ipPrefix") <= 64
    ),
    CONSTRAINT "LoginEvent_user_agent_length_check" CHECK (
        "userAgent" IS NULL OR length("userAgent") <= 512
    ),
    CONSTRAINT "LoginEvent_mfa_method_check" CHECK (
        "mfaMethod" IS NULL OR "mfaMethod" IN ('TOTP', 'EMAIL_OTP', 'SMS_OTP', 'RECOVERY_CODE')
    ),
    CONSTRAINT "LoginEvent_failure_reason_length_check" CHECK (
        "failureReason" IS NULL OR length("failureReason") <= 200
    ),
    CONSTRAINT "LoginEvent_subject_check" CHECK (
        "userId" IS NOT NULL OR "identifierHash" IS NOT NULL OR "ipHash" IS NOT NULL
    )
);

-- CreateTable
CREATE TABLE "UserDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceFingerprintHash" TEXT NOT NULL,
    "label" TEXT,
    "userAgent" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIpHash" TEXT,
    "isRecognized" BOOLEAN NOT NULL DEFAULT false,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserDevice_fingerprint_hash_check" CHECK (
        "deviceFingerprintHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "UserDevice_last_ip_hash_check" CHECK (
        "lastIpHash" IS NULL OR "lastIpHash" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "UserDevice_seen_count_check" CHECK ("seenCount" >= 1),
    CONSTRAINT "UserDevice_label_length_check" CHECK (
        "label" IS NULL OR length(btrim("label")) BETWEEN 1 AND 80
    ),
    CONSTRAINT "UserDevice_seen_window_check" CHECK ("lastSeenAt" >= "firstSeenAt")
);

-- CreateIndex
CREATE INDEX "LoginEvent_userId_occurredAt_idx" ON "LoginEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "LoginEvent_deviceFingerprintHash_occurredAt_idx" ON "LoginEvent"("deviceFingerprintHash", "occurredAt");

-- CreateIndex
CREATE INDEX "LoginEvent_ipHash_occurredAt_idx" ON "LoginEvent"("ipHash", "occurredAt");

-- CreateIndex
CREATE INDEX "LoginEvent_identifierHash_occurredAt_idx" ON "LoginEvent"("identifierHash", "occurredAt");

-- CreateIndex
CREATE INDEX "LoginEvent_occurredAt_idx" ON "LoginEvent"("occurredAt");

-- Failed-login burst detection scans recent failures only.
CREATE INDEX "LoginEvent_recent_failures_idx"
    ON "LoginEvent" ("identifierHash", "occurredAt")
    WHERE "outcome" = 'FAILURE';

-- CreateIndex
CREATE INDEX "UserDevice_userId_lastSeenAt_idx" ON "UserDevice"("userId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserDevice_userId_deviceFingerprintHash_key" ON "UserDevice"("userId", "deviceFingerprintHash");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDevice" ADD CONSTRAINT "UserDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
