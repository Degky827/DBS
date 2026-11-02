-- Local mirror of the auth-service account status for admin views and guards.
ALTER TABLE "UserProfile"
    ADD COLUMN "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "UserProfile_accountStatus_idx" ON "UserProfile"("accountStatus");
