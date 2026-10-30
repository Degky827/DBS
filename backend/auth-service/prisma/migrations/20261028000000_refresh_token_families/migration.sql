-- Add refresh-token families for rotation and reuse detection.
ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "replacedByTokenHash" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "rotatedAt" TIMESTAMP(3);

-- Existing sessions become their own single-token family.
UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
