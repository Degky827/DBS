const crypto = require("crypto");

const env = require("../../config/env");
const userRepository = require("../../repositories/user.repository");
const refreshTokenRepository = require("../../repositories/refreshToken.repository");
const accessTokenRevocationRepository = require("../../repositories/accessTokenRevocation.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const { comparePassword, DUMMY_HASH } = require("../../utils/password.util");
const {
  signAccessToken,
  verifyMfaChallengeToken,
} = require("../../utils/jwt.util");
const {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  absoluteRefreshTokenExpiry,
} = require("../../utils/refreshToken.util");
const {
  generateMfaSecret,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  encryptMfaSecret,
  decryptMfaSecret,
  buildOtpAuthUri,
} = require("../../utils/mfa.util");
const { toPublicUser } = require("../../utils/publicUser");
const { assertAuthenticatable } = require("../../utils/accountStatus");

const INVALID_FACTOR = "Invalid or expired authentication code";

const getStatus = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return {
    enabled: user.mfaEnabled === true,
    enrolledAt: user.mfaEnrolledAt || null,
    recoveryCodesRemaining: (user.mfaRecoveryCodeHashes || []).length,
  };
};

const beginEnrollment = async (userId) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }
  if (user.mfaEnabled) {
    throw ApiError.conflict(
      "Multi-factor authentication is already enabled",
      "MFA_ALREADY_ENABLED"
    );
  }

  const secret = generateMfaSecret();
  await userRepository.update(user.id, {
    mfaSecretEncrypted: encryptMfaSecret(secret),
    mfaEnabled: false,
    mfaEnrolledAt: null,
    mfaRecoveryCodeHashes: [],
  });

  return {
    secret,
    otpauthUri: buildOtpAuthUri({ secret, email: user.email }),
    issuer: env.MFA_ISSUER,
  };
};

const consumeRecoveryCode = async (user, recoveryCode) => {
  const hash = hashRecoveryCode(recoveryCode);
  const hashes = user.mfaRecoveryCodeHashes || [];
  const index = hashes.indexOf(hash);

  if (index === -1) return false;

  const remaining = hashes.filter((_, position) => position !== index);
  await userRepository.update(user.id, { mfaRecoveryCodeHashes: remaining });
  audit("MFA_RECOVERY_CODE_USED", {
    userId: user.id,
    remaining: remaining.length,
  });
  return true;
};

const verifyFactor = async (user, { code, recoveryCode }) => {
  if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
    throw ApiError.conflict(
      "Multi-factor authentication is not enabled for this account",
      "MFA_NOT_ENABLED"
    );
  }

  if (recoveryCode) {
    const accepted = await consumeRecoveryCode(user, recoveryCode);
    if (!accepted) {
      audit("MFA_VERIFY_FAILED", { userId: user.id, method: "RECOVERY" });
      throw ApiError.unauthorized(INVALID_FACTOR, "INVALID_MFA_CODE");
    }
    return;
  }

  let secret;
  try {
    secret = decryptMfaSecret(user.mfaSecretEncrypted);
  } catch {
    throw ApiError.internal(
      "Multi-factor authentication is misconfigured for this account"
    );
  }

  if (!verifyTotp(secret, code)) {
    audit("MFA_VERIFY_FAILED", { userId: user.id, method: "TOTP" });
    throw ApiError.unauthorized(INVALID_FACTOR, "INVALID_MFA_CODE");
  }
};

const confirmEnrollment = async (userId, { code }) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }
  if (user.mfaEnabled) {
    throw ApiError.conflict(
      "Multi-factor authentication is already enabled",
      "MFA_ALREADY_ENABLED"
    );
  }
  if (!user.mfaSecretEncrypted) {
    throw ApiError.conflict(
      "Start multi-factor setup before confirming it",
      "MFA_SETUP_NOT_STARTED"
    );
  }

  let secret;
  try {
    secret = decryptMfaSecret(user.mfaSecretEncrypted);
  } catch {
    throw ApiError.internal(
      "Multi-factor authentication setup is invalid; start again"
    );
  }

  if (!verifyTotp(secret, code)) {
    audit("MFA_ENROLLMENT_FAILED", { userId: user.id });
    throw ApiError.badRequest(INVALID_FACTOR, "INVALID_MFA_CODE");
  }

  const recoveryCodes = generateRecoveryCodes();
  await userRepository.update(user.id, {
    mfaEnabled: true,
    mfaEnrolledAt: new Date(),
    mfaRecoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
  });
  audit("MFA_ENABLED", { userId: user.id });

  return { recoveryCodes, enabled: true };
};

const disable = async (userId, { password, code, recoveryCode }) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }
  if (!user.mfaEnabled) {
    throw ApiError.conflict(
      "Multi-factor authentication is not enabled",
      "MFA_NOT_ENABLED"
    );
  }

  const passwordValid = await comparePassword(
    password,
    user.passwordHash || DUMMY_HASH
  );
  if (!passwordValid) {
    audit("MFA_DISABLE_FAILED", { userId: user.id, reason: "PASSWORD" });
    throw ApiError.unauthorized(
      "Current password is incorrect",
      "INVALID_CURRENT_PASSWORD"
    );
  }

  await verifyFactor(user, { code, recoveryCode });
  await userRepository.update(user.id, {
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaRecoveryCodeHashes: [],
    mfaEnrolledAt: null,
  });
  audit("MFA_DISABLED", { userId: user.id });

  return { enabled: false };
};

const verifyLogin = async ({ mfaToken, code, recoveryCode }) => {
  const payload = verifyMfaChallengeToken(mfaToken);

  if (await accessTokenRevocationRepository.isRevoked(payload.jti)) {
    throw ApiError.unauthorized(
      "Multi-factor challenge has already been used",
      "MFA_CHALLENGE_USED"
    );
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) {
    throw ApiError.unauthorized("Account not found", "INVALID_TOKEN_SUBJECT");
  }
  assertAuthenticatable(user);

  await verifyFactor(user, { code, recoveryCode });

  const expiresAt =
    typeof payload.exp === "number"
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + env.MFA_CHALLENGE_TTL_MS);
  await accessTokenRevocationRepository.revoke({
    jti: payload.jti,
    userId: user.id,
    reason: "MFA_CHALLENGE_USED",
    expiresAt,
  });

  const familyId = crypto.randomUUID();
  const familyExpiresAt = absoluteRefreshTokenExpiry();
  const refreshToken = generateRefreshToken();
  await refreshTokenRepository.create({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    familyExpiresAt,
    expiresAt: refreshTokenExpiry(familyExpiresAt),
  });

  const accessToken = signAccessToken(user, {
    familyId,
    amr: ["pwd", "mfa"],
    stepUpAt: Date.now(),
  });
  audit("MFA_LOGIN_SUCCESS", { userId: user.id });

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken,
  };
};

const stepUp = async ({ userId, sessionId, code, recoveryCode }) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.unauthorized("Account not found", "INVALID_TOKEN_SUBJECT");
  }
  assertAuthenticatable(user);
  await verifyFactor(user, { code, recoveryCode });

  const accessToken = signAccessToken(user, {
    familyId: sessionId || undefined,
    amr: ["pwd", "mfa"],
    stepUpAt: Date.now(),
  });
  audit("MFA_STEP_UP", { userId: user.id });

  return {
    accessToken,
    stepUpExpiresAt: new Date(Date.now() + env.STEP_UP_TTL_MS).toISOString(),
  };
};

const resetForUser = async ({ userId, actorId }) => {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  await userRepository.update(user.id, {
    mfaEnabled: false,
    mfaSecretEncrypted: null,
    mfaRecoveryCodeHashes: [],
    mfaEnrolledAt: null,
  });
  await userRepository.invalidateSessions(user.id);
  await refreshTokenRepository.revokeAllForUser(user.id);
  audit("MFA_RESET_BY_ADMIN", { userId: user.id, actorId });

  return { enabled: false };
};

module.exports = {
  getStatus,
  beginEnrollment,
  confirmEnrollment,
  disable,
  verifyLogin,
  stepUp,
  resetForUser,
};
