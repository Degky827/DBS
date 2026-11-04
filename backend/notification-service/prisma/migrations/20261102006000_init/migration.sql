-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailNextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessedEvent_receivedAt_idx" ON "ProcessedEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventId_recipientEmail_key" ON "Notification"("eventId", "recipientEmail");

-- CreateIndex
CREATE INDEX "Notification_recipientEmail_createdAt_idx" ON "Notification"("recipientEmail", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientEmail_readAt_idx" ON "Notification"("recipientEmail", "readAt");

-- CreateIndex
CREATE INDEX "Notification_emailStatus_emailNextAttemptAt_idx" ON "Notification"("emailStatus", "emailNextAttemptAt");
