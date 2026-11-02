const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const CURRENT_KEY = "b".repeat(64);
const PREVIOUS_KEY = "a".repeat(64);
const storageDir = path.join(os.tmpdir(), `kyc-keyring-${crypto.randomUUID()}`);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  "postgresql://test:test@localhost:5432/kyc_storage_test?schema=public";
process.env.STORAGE_DIR = storageDir;
process.env.STORAGE_ENCRYPTION_KEY = CURRENT_KEY;
process.env.STORAGE_ENCRYPTION_KEYS_PREVIOUS = PREVIOUS_KEY;
process.env.LOG_LEVEL = "silent";

const secureStorage = require("../src/utils/secureStorage");

const encryptWithKey = (buffer, hexKey) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(hexKey, "hex"),
    iv
  );
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
};

test("new values are encrypted with the current key", () => {
  const encrypted = secureStorage.encryptSensitiveValue("session-url");
  const decrypted = secureStorage.decryptBuffer(
    Buffer.from(encrypted, "base64"),
    "unexpected"
  );

  assert.equal(decrypted.currentKey, true);
  assert.equal(decrypted.plaintext.toString("utf8"), "session-url");
  assert.equal(secureStorage.decryptSensitiveValue(encrypted), "session-url");
});

test("values encrypted with a retired key remain readable", () => {
  const legacy = encryptWithKey(Buffer.from("legacy-value", "utf8"), PREVIOUS_KEY);
  const result = secureStorage.decryptBuffer(legacy, "unexpected");

  assert.equal(result.currentKey, false);
  assert.equal(result.plaintext.toString("utf8"), "legacy-value");
  assert.equal(
    secureStorage.decryptSensitiveValue(legacy.toString("base64")),
    "legacy-value"
  );
});

test("stored files can be detected as stale and re-encrypted atomically", async () => {
  const storageKey = `${crypto.randomUUID()}.enc`;
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(
    path.join(storageDir, storageKey),
    encryptWithKey(Buffer.from("document-bytes"), PREVIOUS_KEY)
  );

  const before = await secureStorage.decryptStoredWithKeyStatus(storageKey);
  assert.equal(before.currentKey, false);
  assert.equal(before.plaintext.toString(), "document-bytes");

  await secureStorage.replaceStoredFile(storageKey, before.plaintext);

  const after = await secureStorage.decryptStoredWithKeyStatus(storageKey);
  assert.equal(after.currentKey, true);

  const content = await secureStorage.decryptFromStorage(storageKey);
  assert.equal(content.toString(), "document-bytes");
});

test("unknown keys fail closed", () => {
  const foreign = encryptWithKey(Buffer.from("foreign"), "c".repeat(64));
  assert.throws(
    () => secureStorage.decryptBuffer(foreign, "cannot decrypt"),
    (error) => error.message === "cannot decrypt"
  );
});
