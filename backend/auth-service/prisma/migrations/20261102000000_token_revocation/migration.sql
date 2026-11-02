-- Access-token revocation and absolute refresh-session lifetime.
ALTER TABLE "User" ADD COLUMN "tokenValidAfter" TIMESTAMP(3);

ALTER TABLE "RefreshToken" ADD COLUMN "familyExpiresAt" TIMESTAMP(3);

-- Existing sessions keep the lifetime they were issued with.
UPDATE "RefreshToken"
SET "familyExpiresAt" = "expiresAt"
WHERE "familyExpiresAt" IS NULL;

CREATE TABLE "AccessTokenRevocation" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessTokenRevocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccessTokenRevocation_jti_key" ON "AccessTokenRevocation"("jti");
CREATE INDEX "AccessTokenRevocation_userId_idx" ON "AccessTokenRevocation"("userId");
CREATE INDEX "AccessTokenRevocation_expiresAt_idx" ON "AccessTokenRevocation"("expiresAt");

ALTER TABLE "AccessTokenRevocation"
ADD CONSTRAINT "AccessTokenRevocation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
