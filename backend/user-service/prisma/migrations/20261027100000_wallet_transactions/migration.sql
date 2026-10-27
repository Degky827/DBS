CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'ETB',
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Wallet_balance_nonnegative_check" CHECK ("balance" >= 0),
    CONSTRAINT "Wallet_currency_etb_check" CHECK ("currency" = 'ETB')
);

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "initiatedByUserId" TEXT NOT NULL,
    "sourceWalletId" TEXT NOT NULL,
    "destinationWalletId" TEXT NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Transaction_amount_positive_check" CHECK ("amount" > 0),
    CONSTRAINT "Transaction_distinct_wallets_check" CHECK ("sourceWalletId" <> "destinationWalletId")
);

CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE UNIQUE INDEX "Transaction_reference_key" ON "Transaction"("reference");
CREATE UNIQUE INDEX "Transaction_initiatedByUserId_idempotencyKey_key"
    ON "Transaction"("initiatedByUserId", "idempotencyKey");
CREATE INDEX "Transaction_sourceWalletId_createdAt_idx"
    ON "Transaction"("sourceWalletId", "createdAt");
CREATE INDEX "Transaction_destinationWalletId_createdAt_idx"
    ON "Transaction"("destinationWalletId", "createdAt");
CREATE INDEX "Transaction_initiatedByUserId_idx"
    ON "Transaction"("initiatedByUserId");

ALTER TABLE "Wallet"
    ADD CONSTRAINT "Wallet_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "UserProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_initiatedByUserId_fkey"
    FOREIGN KEY ("initiatedByUserId") REFERENCES "UserProfile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_sourceWalletId_fkey"
    FOREIGN KEY ("sourceWalletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction"
    ADD CONSTRAINT "Transaction_destinationWalletId_fkey"
    FOREIGN KEY ("destinationWalletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;