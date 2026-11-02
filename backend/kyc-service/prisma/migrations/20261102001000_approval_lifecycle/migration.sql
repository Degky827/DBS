-- Time-boxed KYC approvals and explicit revocation.
ALTER TABLE "KycSubmission" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "KycSubmission" ADD COLUMN "approvalExpiresAt" TIMESTAMP(3);
ALTER TABLE "KycSubmission" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "KycSubmission" ADD COLUMN "revokedReason" TEXT;

-- Existing approvals receive the default one-year lifetime, measured from the
-- officer decision. Adjust the interval if the deployed policy differs.
UPDATE "KycSubmission"
SET "approvedAt" = "reviewedAt",
    "approvalExpiresAt" = "reviewedAt" + INTERVAL '365 days'
WHERE "status" = 'APPROVED'
  AND "reviewedAt" IS NOT NULL;
