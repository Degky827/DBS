-- Durable storage for encrypted KYC documents when no persistent disk is
-- available. Used only when STORAGE_BACKEND=postgres.

CREATE TABLE "StoredDocumentBlob" (
    "storageKey" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoredDocumentBlob_pkey" PRIMARY KEY ("storageKey")
);
