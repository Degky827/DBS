-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CHAPA',
    "providerRef" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(19,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "idempotencyKey" TEXT NOT NULL,
    "checkoutUrl" TEXT,
    "failureReason" TEXT,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Payment_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "Payment_currency_etb_check" CHECK ("currency" = 'ETB'),
    CONSTRAINT "Payment_type_deposit_check" CHECK ("type" = 'DEPOSIT'),
    CONSTRAINT "Payment_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'FAILED')),
    CONSTRAINT "Payment_provider_chapa_check" CHECK ("provider" = 'CHAPA')
);

-- A deposit is represented as a ledger transaction with no source wallet.
ALTER TABLE "Transaction"
    ALTER COLUMN "sourceWalletId" DROP NOT NULL,
    ADD COLUMN "type" TEXT NOT NULL DEFAULT 'TRANSFER',
    ADD COLUMN "paymentId" TEXT;

ALTER TABLE "Transaction"
    DROP CONSTRAINT "Transaction_distinct_wallets_check",
    ADD CONSTRAINT "Transaction_shape_check" CHECK (
        ("type" = 'TRANSFER' AND "sourceWalletId" IS NOT NULL AND "destinationWalletId" IS NOT NULL AND "sourceWalletId" <> "destinationWalletId" AND "paymentId" IS NULL)
        OR
        ("type" = 'DEPOSIT' AND "sourceWalletId" IS NULL AND "destinationWalletId" IS NOT NULL AND "paymentId" IS NOT NULL)
    );

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_walletId_createdAt_idx" ON "Payment"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_paymentId_key" ON "Transaction"("paymentId");

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_bodyHash_key" ON "PaymentWebhookEvent"("bodyHash");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_paymentReference_receivedAt_idx"
    ON "PaymentWebhookEvent"("paymentReference", "receivedAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentWebhookEvent"
    ADD CONSTRAINT "PaymentWebhookEvent_paymentReference_fkey"
    FOREIGN KEY ("paymentReference") REFERENCES "Payment"("reference")
    ON DELETE RESTRICT ON UPDATE CASCADE;
