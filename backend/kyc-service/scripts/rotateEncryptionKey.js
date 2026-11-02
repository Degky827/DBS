#!/usr/bin/env node

// Re-encrypts KYC data with the current STORAGE_ENCRYPTION_KEY.
//
// Usage:
//   STORAGE_ENCRYPTION_KEY=<new> \
//   STORAGE_ENCRYPTION_KEYS_PREVIOUS=<old> \
//   node scripts/rotateEncryptionKey.js [--dry-run]
//
// Run with --dry-run first. The job is idempotent: rows and files already
// encrypted with the current key are skipped. Only remove the retired key from
// STORAGE_ENCRYPTION_KEYS_PREVIOUS after a clean, failure-free run.

const prisma = require("../src/config/database");
const env = require("../src/config/env");
const secureStorage = require("../src/utils/secureStorage");

const dryRun = process.argv.includes("--dry-run");
const SENSITIVE_FIELDS = ["ocrText", "extractedData"];

const rotateSensitiveFields = async (record, model) => {
  const updates = {};

  for (const field of SENSITIVE_FIELDS) {
    if (!record[field]) continue;
    const { plaintext, currentKey } = secureStorage.decryptBuffer(
      Buffer.from(record[field], "base64"),
      `${model} ${record.id} field ${field} could not be decrypted`
    );
    if (!currentKey) {
      updates[field] = secureStorage.encryptSensitiveValue(
        plaintext.toString("utf8")
      );
    }
  }

  const fields = Object.keys(updates);
  if (fields.length > 0 && !dryRun) {
    await model.update({ where: { id: record.id }, data: updates });
  }
  return fields.length;
};

const run = async () => {
  if (!env.STORAGE_ENCRYPTION_KEY) {
    throw new Error("STORAGE_ENCRYPTION_KEY must be set to the new key");
  }
  if (env.STORAGE_ENCRYPTION_KEYS_PREVIOUS.length === 0) {
    throw new Error(
      "STORAGE_ENCRYPTION_KEYS_PREVIOUS must contain the retired key(s)"
    );
  }

  const summary = {
    dryRun,
    documentsScanned: 0,
    filesRotated: 0,
    filesAlreadyCurrent: 0,
    documentFieldsRotated: 0,
    submissionsScanned: 0,
    submissionFieldsRotated: 0,
    failures: [],
  };

  const documents = await prisma.kycDocument.findMany({
    select: { id: true, storageKey: true, ocrText: true, extractedData: true },
  });

  for (const document of documents) {
    summary.documentsScanned += 1;
    try {
      const stored = await secureStorage.decryptStoredWithKeyStatus(
        document.storageKey
      );
      if (stored.currentKey) {
        summary.filesAlreadyCurrent += 1;
      } else {
        if (!dryRun) {
          await secureStorage.replaceStoredFile(
            document.storageKey,
            stored.plaintext
          );
        }
        summary.filesRotated += 1;
      }

      summary.documentFieldsRotated += await rotateSensitiveFields(
        document,
        prisma.kycDocument
      );
    } catch (error) {
      summary.failures.push({ documentId: document.id, error: error.message });
    }
  }

  const submissions = await prisma.kycSubmission.findMany({
    where: { providerSessionUrlEncrypted: { not: null } },
    select: { id: true, providerSessionUrlEncrypted: true },
  });

  for (const submission of submissions) {
    summary.submissionsScanned += 1;
    try {
      const { plaintext, currentKey } = secureStorage.decryptBuffer(
        Buffer.from(submission.providerSessionUrlEncrypted, "base64"),
        `KycSubmission ${submission.id} session URL could not be decrypted`
      );
      if (!currentKey) {
        if (!dryRun) {
          await prisma.kycSubmission.update({
            where: { id: submission.id },
            data: {
              providerSessionUrlEncrypted:
                secureStorage.encryptSensitiveValue(plaintext.toString("utf8")),
            },
          });
        }
        summary.submissionFieldsRotated += 1;
      }
    } catch (error) {
      summary.failures.push({ submissionId: submission.id, error: error.message });
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failures.length > 0) {
    console.error(
      "Rotation finished with failures. Keep the retired key configured and investigate before retrying."
    );
    process.exitCode = 1;
  } else {
    console.log(
      dryRun
        ? "Dry run complete. Re-run without --dry-run to apply."
        : "Rotation complete. Remove the retired key from STORAGE_ENCRYPTION_KEYS_PREVIOUS after verification."
    );
  }
};

run()
  .catch((error) => {
    console.error(`Rotation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
