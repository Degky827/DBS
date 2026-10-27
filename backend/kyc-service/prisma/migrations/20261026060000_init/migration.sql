CREATE TABLE "KycSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "documentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "verificationScore" DOUBLE PRECISION,
    "decisionReason" TEXT,
    "comparisonResults" JSONB,
    "documentVerificationStatus" TEXT,
    "dataComparisonStatus" TEXT,
    "faceMatchStatus" TEXT,
    "livenessStatus" TEXT,
    "providerStatus" TEXT,
    "providerSessionId" TEXT,
    "providerSessionUrlEncrypted" TEXT,
    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT,
    "side" TEXT,
    "ocrText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "extractedData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycReview" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycAuditEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycProviderEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "submissionId" TEXT,
    "eventType" TEXT NOT NULL,
    "providerStatus" TEXT,
    "providerObjectId" TEXT,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KycSubmission_providerSessionId_key" ON "KycSubmission"("providerSessionId");
CREATE INDEX "KycSubmission_userId_createdAt_idx" ON "KycSubmission"("userId", "createdAt");
CREATE INDEX "KycDocument_submissionId_idx" ON "KycDocument"("submissionId");
CREATE INDEX "KycReview_submissionId_idx" ON "KycReview"("submissionId");
CREATE INDEX "KycAuditEvent_submissionId_eventType_idx" ON "KycAuditEvent"("submissionId", "eventType");
CREATE UNIQUE INDEX "KycProviderEvent_eventId_key" ON "KycProviderEvent"("eventId");
CREATE INDEX "KycProviderEvent_submissionId_createdAt_idx" ON "KycProviderEvent"("submissionId", "createdAt");
CREATE INDEX "KycProviderEvent_providerObjectId_eventTimestamp_idx" ON "KycProviderEvent"("providerObjectId", "eventTimestamp");

ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycReview" ADD CONSTRAINT "KycReview_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycAuditEvent" ADD CONSTRAINT "KycAuditEvent_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KycProviderEvent" ADD CONSTRAINT "KycProviderEvent_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "KycSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
