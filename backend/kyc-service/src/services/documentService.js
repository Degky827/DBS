const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const sharp = require("sharp");
const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const secureStorage = require("../utils/secureStorage");
const ocrProvider = require("../providers/tesseractOcrProvider");
const { EDITABLE_STATUSES, isEditable } = require("../constants/kycStatus");

const IMAGE_TYPES = [
  {
    mimeType: "image/jpeg",
    extension: "jpg",
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  {
    mimeType: "image/png",
    extension: "png",
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ),
  },
  {
    mimeType: "image/webp",
    extension: "webp",
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP",
  },
];

function verifyImageContent(file) {
  const imageType = IMAGE_TYPES.find(
    (type) => type.mimeType === file.mimetype && type.matches(file.buffer)
  );
  if (!imageType) {
    throw ApiError.badRequest(
      "Document contents do not match a supported JPEG, PNG, or WebP image",
      "INVALID_DOCUMENT_CONTENT"
    );
  }
  return imageType;
}

async function normalizeImage(buffer, expectedType) {
  try {
    const image = sharp(buffer, { limitInputPixels: 25_000_000 });
    const metadata = await image.metadata();
    if (
      metadata.format !== expectedType.extension.replace("jpg", "jpeg") &&
      !(expectedType.extension === "jpg" && metadata.format === "jpeg")
    ) {
      throw new Error("image format mismatch");
    }
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 25_000_000 ||
      (metadata.pages || 1) > 1
    ) {
      throw new Error("unsupported image dimensions");
    }
    return await image
      .rotate()
      .resize({ width: 5000, height: 5000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw ApiError.badRequest(
      "The uploaded file is not a valid supported image",
      "INVALID_DOCUMENT_CONTENT"
    );
  }
}

function buildFields(text, confidence) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value, index) => {
      const match =
        value.match(
          /^(first\s*name|given\s*names?|last\s*name|surname|family\s*name|date of birth|birth date|dob)\s*[:-]?\s+(.+)$/i
        ) || value.match(/^([^:]{2,50}):\s*(.+)$/);
      return {
        key: `field_${index + 1}`,
        label: match ? match[1].trim() : `Line ${index + 1}`,
        value: match ? match[2].trim() : value,
        confidence,
        needsCorrection: true,
      };
    });
}

async function uploadDocument({ userId, submissionId, file, documentType, side }) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw ApiError.badRequest("A document image is required", "DOCUMENT_REQUIRED");
  }
  const imageType = verifyImageContent(file);
  const normalizedImage = await normalizeImage(file.buffer, imageType);
  const submission = await prisma.kycSubmission.findFirst({
    where: { id: submissionId, userId },
    select: { id: true, status: true },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  if (!["DRAFT", "NEEDS_RESUBMISSION"].includes(submission.status)) {
    throw ApiError.conflict(
      "Documents can only be changed on a draft or resubmission",
      "SUBMISSION_NOT_EDITABLE"
    );
  }

  const documentId = crypto.randomUUID();
  const storageKey = `${documentId}.enc`;
  await secureStorage.encryptAndStore(file.buffer, storageKey);

  try {
    let recognized;
    try {
      recognized = await ocrProvider.recognize(normalizedImage);
    } catch {
      throw ApiError.serviceUnavailable(
        "Document OCR is temporarily unavailable",
        "OCR_UNAVAILABLE"
      );
    }
    if (typeof recognized.text !== "string" || !Number.isFinite(recognized.confidence)) {
      throw ApiError.badGateway("OCR provider returned an invalid result");
    }
    const extractedFields = buildFields(recognized.text, recognized.confidence);

    await prisma.$transaction(async (tx) => {
      const invalidated = await tx.kycSubmission.updateMany({
        where: { id: submissionId, status: { in: [...EDITABLE_STATUSES] } },
        data: {
          dataComparisonStatus: null,
          comparisonResults: Prisma.DbNull,
        },
      });
      if (invalidated.count !== 1) {
        throw ApiError.conflict(
          "Documents can only be changed on a draft or resubmission",
          "SUBMISSION_NOT_EDITABLE"
        );
      }
      await tx.kycDocument.create({
        data: {
          id: documentId,
          submissionId,
          documentType,
          storageKey,
          mimeType: imageType.mimeType,
          fileName: `${documentId}.${imageType.extension}`,
          fileSizeBytes: file.size,
          checksumSha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
          side: side || null,
          ocrText: secureStorage.encryptSensitiveValue(recognized.text),
          ocrConfidence: recognized.confidence,
          extractedData: secureStorage.encryptSensitiveValue(
            JSON.stringify({ fields: extractedFields })
          ),
          status: "OCR_COMPLETE",
        },
        select: {
          id: true,
          documentType: true,
          mimeType: true,
          fileSizeBytes: true,
          side: true,
          ocrText: true,
          ocrConfidence: true,
          extractedData: true,
          status: true,
          createdAt: true,
        },
      });
      await tx.kycAuditEvent.create({
        data: {
          submissionId,
          eventType: "DOCUMENT_OCR_COMPLETED",
          actorId: userId,
          payload: { documentId, documentType, side: side || null },
        },
      });
    });
  } catch (error) {
    try {
      await secureStorage.removeStoredFile(storageKey);
    } catch {
      throw ApiError.internal("Unable to clean up a failed document upload");
    }
    if (error instanceof ApiError) throw error;
    throw error;
  }
  return getDocument(userId, documentId);
}

async function getDocument(userId, documentId) {
  const document = await prisma.kycDocument.findFirst({
    where: { id: documentId, submission: { userId } },
    select: {
      id: true,
      submissionId: true,
      documentType: true,
      mimeType: true,
      fileSizeBytes: true,
      side: true,
      ocrText: true,
      ocrConfidence: true,
      extractedData: true,
      status: true,
      createdAt: true,
      storageKey: true,
      submission: { select: { status: true } },
    },
  });
  if (!document) {
    throw ApiError.notFound("KYC document not found", "KYC_DOCUMENT_NOT_FOUND");
  }
  let extractedData = null;
  if (document.extractedData) {
    try {
      extractedData = JSON.parse(
        secureStorage.decryptSensitiveValue(document.extractedData)
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.internal("Stored OCR data is invalid");
    }
  }
  let ocrText = null;
  if (document.ocrText) {
    ocrText = secureStorage.decryptSensitiveValue(document.ocrText);
  }
  return { ...document, extractedData, ocrText };
}

async function getDocumentContent(userId, documentId) {
  const document = await getDocument(userId, documentId);
  const content = await secureStorage.decryptFromStorage(document.storageKey);
  return { content, mimeType: document.mimeType };
}

async function correctFields(userId, documentId, corrections) {
  const document = await getDocument(userId, documentId);
  if (!isEditable(document.submission.status)) {
    throw ApiError.conflict(
      "OCR fields can only be changed on a draft or resubmission",
      "SUBMISSION_NOT_EDITABLE"
    );
  }
  const originalFields = document.extractedData?.fields || [];
  const values = new Map(originalFields.map((field) => [field.key, field]));
  for (const correction of corrections) {
    if (!values.has(correction.key)) {
      throw ApiError.badRequest(
        "Correction refers to an unknown extracted field",
        "UNKNOWN_OCR_FIELD"
      );
    }
    values.set(correction.key, {
      ...values.get(correction.key),
      correctedValue: correction.value,
      needsCorrection: false,
    });
  }
  const extractedData = {
    fields: [...values.values()],
    correctedAt: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    const invalidated = await tx.kycSubmission.updateMany({
      where: { id: document.submissionId, status: { in: [...EDITABLE_STATUSES] } },
      data: {
        dataComparisonStatus: null,
        comparisonResults: Prisma.DbNull,
      },
    });
    if (invalidated.count !== 1) {
      throw ApiError.conflict(
        "OCR fields can only be changed on a draft or resubmission",
        "SUBMISSION_NOT_EDITABLE"
      );
    }
    await tx.kycDocument.update({
      where: { id: documentId },
      data: {
        extractedData: secureStorage.encryptSensitiveValue(
          JSON.stringify(extractedData)
        ),
      },
      select: { id: true, extractedData: true, status: true, updatedAt: true },
    });
    await tx.kycAuditEvent.create({
      data: {
        submissionId: document.submissionId,
        eventType: "OCR_FIELDS_CORRECTED",
        actorId: userId,
        payload: { documentId, fieldKeys: corrections.map(({ key }) => key) },
      },
    });
  });
  return getDocument(userId, documentId);
}

async function deleteDocument(userId, documentId) {
  const document = await getDocument(userId, documentId);
  if (!isEditable(document.submission.status)) {
    throw ApiError.conflict(
      "Documents cannot be removed after verification has started",
      "SUBMISSION_NOT_EDITABLE"
    );
  }
  await prisma.$transaction(async (tx) => {
    const removed = await tx.kycDocument.deleteMany({
      where: {
        id: documentId,
        submission: { status: { in: [...EDITABLE_STATUSES] } },
      },
    });
    if (removed.count !== 1) {
      throw ApiError.conflict(
        "Documents cannot be removed after verification has started",
        "SUBMISSION_NOT_EDITABLE"
      );
    }
    await tx.kycAuditEvent.create({
      data: {
        submissionId: document.submissionId,
        eventType: "DOCUMENT_DELETED",
        actorId: userId,
        payload: { documentId },
      },
    });
  });
  await secureStorage.removeStoredFile(document.storageKey);
}

const OFFICER_DOCUMENT_SELECT = {
  id: true,
  submissionId: true,
  documentType: true,
  mimeType: true,
  fileName: true,
  fileSizeBytes: true,
  side: true,
  status: true,
  createdAt: true,
};

async function recordOfficerDocumentAccess(officerId, eventType, payload) {
  await prisma.kycAuditEvent.create({
    data: {
      submissionId: payload.submissionId,
      eventType,
      actorId: officerId,
      payload,
    },
  });
}

async function listSubmissionDocumentsForOfficer(officerId, submissionId) {
  const submission = await prisma.kycSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  const rows = await prisma.kycDocument.findMany({
    where: { submissionId },
    orderBy: { createdAt: "asc" },
    select: OFFICER_DOCUMENT_SELECT,
  });
  const documents = rows.map((document) => ({
    id: document.id,
    submissionId: document.submissionId,
    documentType: document.documentType,
    mimeType: document.mimeType,
    fileName: document.fileName,
    fileSizeBytes: document.fileSizeBytes,
    side: document.side,
    status: document.status,
    createdAt: document.createdAt,
  }));
  await recordOfficerDocumentAccess(officerId, "OFFICER_DOCUMENTS_LISTED", {
    submissionId,
    documentIds: documents.map((document) => document.id),
    count: documents.length,
  });
  return { submission, documents };
}

async function findOfficerDocument(documentId) {
  const document = await prisma.kycDocument.findUnique({
    where: { id: documentId },
    select: {
      ...OFFICER_DOCUMENT_SELECT,
      ocrText: true,
      ocrConfidence: true,
      extractedData: true,
      storageKey: true,
      submission: { select: { id: true, status: true } },
    },
  });
  if (!document) {
    throw ApiError.notFound("KYC document not found", "KYC_DOCUMENT_NOT_FOUND");
  }
  return document;
}

async function getDocumentForOfficer(officerId, documentId) {
  const document = await findOfficerDocument(documentId);
  let extractedData = null;
  if (document.extractedData) {
    try {
      extractedData = JSON.parse(
        secureStorage.decryptSensitiveValue(document.extractedData)
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.internal("Stored OCR data is invalid");
    }
  }
  const { storageKey: _storageKey, submission, ...metadata } = document;
  await recordOfficerDocumentAccess(officerId, "OFFICER_DOCUMENT_ACCESSED", {
    submissionId: document.submissionId,
    documentId,
  });
  return {
    ...metadata,
    submission: { id: submission.id, status: submission.status },
    extractedData,
  };
}

async function getDocumentContentForOfficer(officerId, documentId) {
  const document = await findOfficerDocument(documentId);
  let content;
  try {
    content = await secureStorage.decryptFromStorage(document.storageKey);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw ApiError.notFound(
        "KYC document evidence is unavailable",
        "KYC_DOCUMENT_UNAVAILABLE"
      );
    }
    throw error;
  }
  await recordOfficerDocumentAccess(officerId, "OFFICER_DOCUMENT_CONTENT_ACCESSED", {
    submissionId: document.submissionId,
    documentId,
  });
  return { content, mimeType: document.mimeType };
}

module.exports = {
  uploadDocument,
  getDocument,
  getDocumentContent,
  correctFields,
  deleteDocument,
  listSubmissionDocumentsForOfficer,
  getDocumentForOfficer,
  getDocumentContentForOfficer,
};
