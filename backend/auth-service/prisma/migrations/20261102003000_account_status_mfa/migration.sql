-- Account lifecycle state and TOTP MFA enrollment.
ALTER TABLE "User"
    ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "statusReason" TEXT,
    ADD COLUMN "statusChangedAt" TIMESTAMP(3),
    ADD COLUMN "statusChangedBy" TEXT,
    ADD COLUMN "closedAt" TIMESTAMP(3),
    ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mfaSecretEncrypted" TEXT,
    ADD COLUMN "mfaRecoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3);

CREATE INDEX "User_status_idx" ON "User"("status");
