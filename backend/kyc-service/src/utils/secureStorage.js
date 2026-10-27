const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const env = require("../config/env");
const ApiError = require("./ApiError");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function readKey() {
  if (!env.STORAGE_ENCRYPTION_KEY) {
    throw ApiError.serviceUnavailable(
      "Document storage encryption is not configured",
      "STORAGE_ENCRYPTION_UNAVAILABLE"
    );
  }
  return Buffer.from(env.STORAGE_ENCRYPTION_KEY, "hex");
}

function resolveStoragePath(storageKey) {
  if (!/^[a-f0-9-]+\.enc$/i.test(storageKey)) {
    throw ApiError.internal("Invalid document storage reference");
  }
  const root = path.resolve(env.STORAGE_DIR);
  const resolved = path.resolve(root, storageKey);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw ApiError.internal("Invalid document storage reference");
  }
  return resolved;
}

async function encryptAndStore(buffer, storageKey) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, readKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  const filePath = resolveStoragePath(storageKey);

  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, encrypted, { flag: "wx", mode: 0o600 });
}

function encryptSensitiveValue(value) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, readKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(value, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

function decryptSensitiveValue(value) {
  const encrypted = Buffer.from(value, "base64");
  if (encrypted.length < IV_LENGTH + TAG_LENGTH) {
    throw ApiError.internal("Stored document data is invalid");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    readKey(),
    encrypted.subarray(0, IV_LENGTH)
  );
  decipher.setAuthTag(encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  try {
    return Buffer.concat([
      decipher.update(encrypted.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw ApiError.internal("Stored document data could not be decrypted");
  }
}

async function decryptFromStorage(storageKey) {
  const encrypted = await fs.readFile(resolveStoragePath(storageKey));
  if (encrypted.length < IV_LENGTH + TAG_LENGTH) {
    throw ApiError.internal("Stored document is invalid");
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const tag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, readKey(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw ApiError.internal("Stored document could not be decrypted");
  }
}

async function removeStoredFile(storageKey) {
  try {
    await fs.unlink(resolveStoragePath(storageKey));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

module.exports = {
  encryptAndStore,
  decryptFromStorage,
  encryptSensitiveValue,
  decryptSensitiveValue,
  removeStoredFile,
};
