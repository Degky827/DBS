const crypto = require("crypto");
const env = require("../config/env");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_BYTES = 6;

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(input) {
  const normalized = String(input).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function generateMfaSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function generateTotp(secret, { timestamp = Date.now(), step = 0 } = {}) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS) + step;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto
    .createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function normalizeTotp(token) {
  return String(token ?? "").replace(/\s+/g, "");
}

function verifyTotp(secret, token, { window = 1, timestamp = Date.now() } = {}) {
  const candidate = normalizeTotp(token);
  if (!/^\d{6}$/.test(candidate)) return false;

  for (let step = -window; step <= window; step += 1) {
    const expected = generateTotp(secret, { timestamp, step });
    if (
      expected.length === candidate.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))
    ) {
      return true;
    }
  }

  return false;
}

function normalizeRecoveryCode(code) {
  return String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
}

function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let index = 0; index < count; index += 1) {
    const raw = encodeBase32(crypto.randomBytes(RECOVERY_CODE_BYTES)).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

function recoveryCodeKey() {
  if (env.MFA_ENCRYPTION_KEY) {
    return Buffer.from(env.MFA_ENCRYPTION_KEY, "hex");
  }
  // Fallback keeps deployments that predate MFA working. Rotating JWT_SECRET
  // invalidates existing MFA secrets in that case; set MFA_ENCRYPTION_KEY to
  // decouple the two.
  return crypto
    .createHash("sha256")
    .update(`meridian-mfa:${env.JWT_SECRET || env.JWT_PRIVATE_KEY}`)
    .digest();
}

function hashRecoveryCode(code) {
  return crypto
    .createHmac("sha256", recoveryCodeKey())
    .update(normalizeRecoveryCode(code))
    .digest("hex");
}

function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", recoveryCodeKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptMfaSecret(value) {
  const [version, iv, tag, ciphertext] = String(value ?? "").split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Stored MFA secret is invalid");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    recoveryCodeKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function buildOtpAuthUri({ secret, email }) {
  const issuer = env.MFA_ISSUER;
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  generateMfaSecret,
  generateTotp,
  verifyTotp,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  encryptMfaSecret,
  decryptMfaSecret,
  buildOtpAuthUri,
  TOTP_PERIOD_SECONDS,
  TOTP_DIGITS,
};
