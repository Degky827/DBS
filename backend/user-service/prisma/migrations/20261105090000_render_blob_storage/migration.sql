-- Durable storage for uploaded avatars when no persistent disk is available.
-- Used only when AVATAR_STORAGE_BACKEND=postgres.

CREATE TABLE "AvatarBlob" (
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvatarBlob_pkey" PRIMARY KEY ("filename")
);
