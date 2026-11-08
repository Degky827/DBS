const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const env = require("../config/env");
const prisma = require("../config/database");
const ApiError = require("./ApiError");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const USE_DATABASE = env.STORAGE_BACKEND === "postgres";

// The keyring keeps the current key first and retired keys after it. New data
// is always written with the current key; reads try every key so a rotation can
// re-encrypt stored data without downtime.
function readKeys() {
  if (!env.STORAGE_ENCRYPTION_KEY) {
    throw ApiError.serviceUnavailable(
      "Document storage encryption is not configured",
      "STORAGE_ENCRYPTION_UNAVAILABLE"
    );
  }

  return [
    Buffer.from(env.STORAGE_ENCRYPTION_KEY, "hex"),
    ...env.STORAGE_ENCRYPTION_KEYS_PREVIOUS.map((key) => Buffer.from(key, "hex")),
  ];
}

function encryptBuffer(buffer, key = readKeys()[0]) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBufferWithKey(encrypted, key) {
  if (encrypted.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext is too short");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, encrypted.subarray(0, IV_LENGTH));
  decipher.setAuthTag(encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
  return Buffer.concat([
    decipher.update(encrypted.subarray(IV_LENGTH + TAG_LENGTH)),
    decipher.final(),
  ]);
}

// Returns the plaintext plus whether the current key already decrypts it,
// which lets the rotation job skip data that is already up to date.
function decryptBuffer(encrypted, invalidMessage) {
  const keys = readKeys();

  for (let index = 0; index < keys.length; index += 1) {
    try {
      return {
        plaintext: decryptBufferWithKey(encrypted, keys[index]),
        currentKey: index === 0,
      };
    } catch {
      // Wrong key or corrupted payload; try the next retired key.
    }
  }

  throw ApiError.internal(invalidMessage);
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

async function readEncrypted(storageKey) {
  if (USE_DATABASE) {
    const row = await prisma.storedDocumentBlob.findUnique({ where: { storageKey } });
    if (!row) {
      const error = new Error("Stored document not found");
      error.code = "ENOENT";
      throw error;
    }
    return Buffer.from(row.data);
  }
  return fs.readFile(resolveStoragePath(storageKey));
}

async function encryptAndStore(buffer, storageKey) {
  const encrypted = encryptBuffer(buffer);

  if (USE_DATABASE) {
    await prisma.storedDocumentBlob.create({ data: { storageKey, data: encrypted } });
    return;
  }

  const filePath = resolveStoragePath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, encrypted, { flag: "wx", mode: 0o600 });
}

function encryptSensitiveValue(value) {
  return encryptBuffer(Buffer.from(value, "utf8")).toString("base64");
}

function decryptSensitiveValue(value) {
  const { plaintext } = decryptBuffer(
    Buffer.from(value, "base64"),
    "Stored document data could not be decrypted"
  );
  return plaintext.toString("utf8");
}

async function decryptFromStorage(storageKey) {
  const encrypted = await readEncrypted(storageKey);
  const { plaintext } = decryptBuffer(encrypted, "Stored document could not be decrypted");
  return plaintext;
}

// Rotation helpers: the caller (script/rotateEncryptionKey.js) re-encrypts with
// the current key and writes the result atomically next to the original.
async function decryptStoredWithKeyStatus(storageKey) {
  const encrypted = await readEncrypted(storageKey);
  return decryptBuffer(encrypted, "Stored document could not be decrypted");
}

async function replaceStoredFile(storageKey, plaintext) {
  const encrypted = encryptBuffer(plaintext);

  if (USE_DATABASE) {
    await prisma.storedDocumentBlob.upsert({
      where: { storageKey },
      update: { data: encrypted },
      create: { storageKey, data: encrypted },
    });
    return;
  }

  const filePath = resolveStoragePath(storageKey);
  const temporaryPath = `${filePath}.rotate-${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, encrypted, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

async function removeStoredFile(storageKey) {
  if (USE_DATABASE) {
    await prisma.storedDocumentBlob.deleteMany({ where: { storageKey } });
    return;
  }

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
  decryptStoredWithKeyStatus,
  replaceStoredFile,
  decryptBuffer,
  encryptBuffer,
};
