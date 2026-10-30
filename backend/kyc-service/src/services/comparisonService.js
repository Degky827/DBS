const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const secureStorage = require("../utils/secureStorage");
const userServiceClient = require("./userServiceClient");
const { COMPARABLE_STATUSES, isComparable } = require("../constants/kycStatus");

const FIELD_LABELS = {
  firstName: ["first name", "given name", "given names"],
  lastName: ["last name", "surname", "family name"],
  dateOfBirth: ["date of birth", "birth date", "dob"],
};

function normalizeText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDate(value) {
  const text = String(value).trim();
  let parts;
  let year;
  let month;
  let day;

  if ((parts = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [, year, month, day] = parts;
  } else if ((parts = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    if (first <= 12 && second <= 12) {
      return null;
    }
    if (first > 12) {
      [, day, month, year] = parts;
    } else {
      [, month, day, year] = parts;
    }
  } else {
    return null;
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function profileDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function readOcrField(fields, labels) {
  const normalizedLabels = labels.map(normalizeText);
  const matches = fields.filter((field) =>
    normalizedLabels.includes(normalizeText(field.label))
  );
  if (matches.length !== 1) return null;
  return matches[0].correctedValue ?? matches[0].value ?? null;
}

function compareValue(ocrValue, profileValue, isDate = false) {
  if (!ocrValue || !profileValue) return "REVIEW_REQUIRED";
  const left = isDate ? normalizeDate(ocrValue) : normalizeText(ocrValue);
  const right = isDate ? profileDate(profileValue) : normalizeText(profileValue);
  if (!left || !right) return "REVIEW_REQUIRED";
  return left === right ? "MATCH" : "MISMATCH";
}

async function compareSubmission(userId, authorization, submissionId) {
  const submission = await prisma.kycSubmission.findFirst({
    where: { id: submissionId, userId },
    select: { id: true, status: true },
  });
  if (!submission) {
    throw ApiError.notFound("KYC submission not found", "KYC_SUBMISSION_NOT_FOUND");
  }
  if (!isComparable(submission.status)) {
    throw ApiError.conflict(
      "Profile comparison is not available in this submission state",
      "SUBMISSION_NOT_COMPARABLE"
    );
  }

  const profile = await userServiceClient.getMyProfile(authorization);
  const documents = await prisma.kycDocument.findMany({
    where: { submissionId },
    select: { id: true, extractedData: true },
  });
  const fields = documents.flatMap((document) => {
    if (!document.extractedData) return [];
    const extracted = JSON.parse(
      secureStorage.decryptSensitiveValue(document.extractedData)
    );
    return extracted.fields || [];
  });

  const outcomes = Object.entries(FIELD_LABELS).map(([field, labels]) => {
    const ocrValue = readOcrField(fields, labels);
    const profileValue = profile[field];
    const status = compareValue(
      ocrValue,
      profileValue,
      field === "dateOfBirth"
    );
    return { field, status };
  });
  const status = outcomes.some((result) => result.status === "MISMATCH")
    ? "MISMATCH"
    : outcomes.some((result) => result.status !== "MATCH")
      ? "REVIEW_REQUIRED"
      : "MATCH";

  await prisma.$transaction(async (tx) => {
    const updated = await tx.kycSubmission.updateMany({
      where: {
        id: submissionId,
        userId,
        status: { in: [...COMPARABLE_STATUSES] },
      },
      data: { dataComparisonStatus: status, comparisonResults: outcomes },
    });
    if (updated.count !== 1) {
      throw ApiError.conflict(
        "Profile comparison is not available in this submission state",
        "SUBMISSION_NOT_COMPARABLE"
      );
    }
    await tx.kycAuditEvent.create({
      data: {
        submissionId,
        eventType: "PROFILE_COMPARISON_COMPLETED",
        actorId: userId,
        payload: { status, outcomes },
      },
    });
  });

  return { status, fields: outcomes };
}

module.exports = { compareSubmission, normalizeText, normalizeDate };
