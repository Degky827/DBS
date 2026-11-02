-- Track the policy business day for deposits so daily limits can be enforced
-- at initiation and again when a provider callback credits the wallet.
ALTER TABLE "Payment" ADD COLUMN "businessDate" DATE;

UPDATE "Payment" SET "businessDate" = "createdAt"::date WHERE "businessDate" IS NULL;

ALTER TABLE "Payment" ALTER COLUMN "businessDate" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "businessDate" SET DEFAULT CURRENT_DATE;

CREATE INDEX "Payment_userId_type_businessDate_status_idx"
  ON "Payment"("userId", "type", "businessDate", "status");
