const crypto = require("crypto");

const prisma = require("../../config/database");
const env = require("../../config/env");
const userRepository = require("../../repositories/user.repository");
const otpRepository = require("../../repositories/otp.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const logger = require("../../config/logger");
const {
  hashPassword,
  comparePassword,
  DUMMY_HASH,
} = require("../../utils/password.util");
const { signAccessToken } = require("../../utils/jwt.util");
const {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} = require("../../utils/refreshToken.util");
const refreshTokenRepository = require("../../repositories/refreshToken.repository");
const {
  generateOtp,
  hashOtp,
  compareOtp,
  otpExpiry,
  MAX_OTP_ATTEMPTS,
  OTP_PURPOSES,
} = require("../../utils/otp.util");
const {
  sendOtpEmail,
  sendSecurityAlertEmail,
} = require("../../services/email.service");

const EMAIL_DELIVERY_ERROR = "EMAIL_DELIVERY_FAILED";
const RESEND_ACKNOWLEDGEMENT =
  "If the account exists, a new verification code has been sent";

const toPublicUser = (user) => ({
  id: user.id,
  firstName: user.firstName,
  middleName: user.middleName,
  lastName: user.lastName,
  username: user.username,
  dateOfBirth: user.dateOfBirth,
  gender: user.gender,
  phoneNumber: user.phoneNumber,
  email: user.email,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  createdAt: user.createdAt,
});

const deliverOtp = async ({ userId, email, otp, purpose }) => {
  try {
    const { delivered } = await sendOtpEmail({ to: email, otp, purpose });
    audit(delivered ? "OTP_ISSUED" : "OTP_EMAIL_NOT_CONFIGURED", { userId, purpose });
    if (!delivered) {
      logger.warn(
        { email, purpose },
        "OTP email transport is not configured"
      );
    }
    return delivered;
  } catch (error) {
    audit("OTP_EMAIL_FAILED", { userId, purpose });
    logger.warn(
      { email, purpose, error: error.message },
      "OTP email delivery failed"
    );
    return false;
  }
};

const issueOtp = async (user, purpose, { awaitDelivery = true } = {}) => {
  const otp = generateOtp();
  await otpRepository.createReplacingActive({
    userId: user.id,
    email: user.email,
    codeHash: await hashOtp(otp),
    purpose,
    expiresAt: otpExpiry(),
  });

  const delivery = deliverOtp({
    userId: user.id,
    email: user.email,
    otp,
    purpose,
  });

  if (!awaitDelivery) {
    // deliverOtp records its own failures; the catch keeps an unexpected
    // rejection from becoming an unhandled promise rejection.
    delivery.catch((error) => {
      logger.warn(
        { email: user.email, purpose, error: error.message },
        "Background OTP delivery failed"
      );
    });
    return { delivered: true };
  }

  return { delivered: await delivery };
};

const verifyOtpRecord = async ({ user, record, otp, errorMessage, failureEvent }) => {
  if (!user || !record) {
    audit(failureEvent, { userId: user?.id || null });
    throw new ApiError(400, errorMessage, "INVALID_OTP");
  }

  const matches = await compareOtp(otp, record.codeHash);
  if (!matches) {
    const attempts = await otpRepository.incrementAttempts(record.id);
    const exhausted = attempts.attempts >= MAX_OTP_ATTEMPTS;
    if (exhausted) {
      await otpRepository.consumeIfActive(record.id);
    }
    audit(failureEvent, {
      userId: user.id,
      attempts: attempts.attempts,
      exhausted,
    });
    throw new ApiError(400, errorMessage, "INVALID_OTP");
  }

  const consumed = await otpRepository.consumeIfActive(record.id);
  if (consumed.count !== 1) {
    audit(failureEvent, { userId: user.id, reason: "ALREADY_USED" });
    throw new ApiError(400, errorMessage, "INVALID_OTP");
  }
  return true;
};

const issueEmailVerificationOtp = (user) =>
  issueOtp(user, OTP_PURPOSES.EMAIL_VERIFICATION);

const register = async (input) => {
  const email = input.email.toLowerCase();

  const existingEmail = await userRepository.findByEmail(email);
  if (existingEmail) {
    throw ApiError.conflict(
      "An account with this email already exists",
      "EMAIL_ALREADY_EXISTS"
    );
  }

  const existingUsername = await userRepository.findByUsername(input.username);
  if (existingUsername) {
    throw ApiError.conflict(
      "An account with this username already exists",
      "USERNAME_ALREADY_EXISTS"
    );
  }

  const passwordHash = await hashPassword(input.password);
  const securityAnswerHash = await hashPassword(input.securityAnswer.toLowerCase());

  const { user, otp } = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        firstName: input.firstName,
        middleName: input.middleName || null,
        lastName: input.lastName,
        username: input.username,
        dateOfBirth: new Date(input.dateOfBirth),
        gender: input.gender,
        phoneNumber: input.phoneNumber,
        email,
        passwordHash,
        securityQuestion: input.securityQuestion,
        securityAnswerHash,
        acceptedTerms: true,
        acceptedTermsAt: new Date(),
        isEmailVerified: false,
      },
    });

    const code = generateOtp();
    await tx.otpCode.create({
      data: {
        userId: newUser.id,
        email: newUser.email,
        codeHash: await hashOtp(code),
        purpose: OTP_PURPOSES.EMAIL_VERIFICATION,
        expiresAt: otpExpiry(),
      },
    });

    return { user: newUser, otp: code };
  });

  audit("REGISTER_SUCCESS", { userId: user.id });

  const delivered = await deliverOtp({
    userId: user.id,
    email: user.email,
    otp,
    purpose: OTP_PURPOSES.EMAIL_VERIFICATION,
  });
  if (!delivered) {
    throw ApiError.serviceUnavailable(
      "Your account was created, but the verification email could not be sent. Please request a new code.",
      EMAIL_DELIVERY_ERROR
    );
  }

  return { user: toPublicUser(user), verificationEmailSent: true };
};

const verifyEmail = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);
  const record = await otpRepository.findLatestActive(
    email,
    OTP_PURPOSES.EMAIL_VERIFICATION
  );

  await verifyOtpRecord({
    user,
    record,
    otp: input.otp,
    errorMessage: "Invalid or expired verification code",
    failureEvent: "OTP_VERIFY_FAILED",
  });

  const updated = await userRepository.markEmailVerified(user.id);
  audit("EMAIL_VERIFIED", { userId: user.id });

  return { user: toPublicUser(updated) };
};

const resendOtp = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  if (!user) {
    return { message: RESEND_ACKNOWLEDGEMENT };
  }

  // Respond the same way as for an unknown address so resend cannot be used
  // to probe which emails are registered or already verified.
  if (user.isEmailVerified) {
    audit("OTP_RESEND_SKIPPED", { userId: user.id, reason: "ALREADY_VERIFIED" });
    return { message: RESEND_ACKNOWLEDGEMENT };
  }

  const { delivered } = await issueEmailVerificationOtp(user);
  if (!delivered) {
    throw ApiError.serviceUnavailable(
      "A verification email could not be sent right now. Please try again later.",
      EMAIL_DELIVERY_ERROR
    );
  }

  return { message: RESEND_ACKNOWLEDGEMENT };
};

const login = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  const isPasswordValid = await comparePassword(
    input.password,
    user ? user.passwordHash : DUMMY_HASH
  );

  if (!user || !isPasswordValid) {
    audit("LOGIN_FAILED", { email });
    throw ApiError.unauthorized(
      "Invalid email or password",
      "INVALID_CREDENTIALS"
    );
  }

  if (!user.isEmailVerified) {
    audit("LOGIN_REJECTED_UNVERIFIED", { userId: user.id });
    throw ApiError.forbidden(
      "Email address is not verified",
      "EMAIL_NOT_VERIFIED"
    );
  }

  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  await refreshTokenRepository.create({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    familyId: crypto.randomUUID(),
    expiresAt: refreshTokenExpiry(),
  });
  audit("LOGIN_SUCCESS", { userId: user.id });

  return { user: toPublicUser(user), accessToken, refreshToken };
};

const getMe = async (userId) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { user: toPublicUser(user) };
};

const toNotificationPreferences = (user) => ({
  securityEmailAlerts: user.securityEmailAlerts !== false,
});

const getNotificationPreferences = async (userId) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { preferences: toNotificationPreferences(user) };
};

const updateNotificationPreferences = async (userId, input) => {
  const user = await userRepository.updateNotificationPreferences(userId, {
    securityEmailAlerts: input.securityEmailAlerts,
  });

  return { preferences: toNotificationPreferences(user) };
};

const sendPasswordChangedAlert = async (user, via) => {
  if (!user?.email || user.securityEmailAlerts === false) return;

  try {
    await sendSecurityAlertEmail({
      to: user.email,
      changedAt: new Date(),
      via,
    });
  } catch (error) {
    // The password change already succeeded; alert delivery must never undo it.
    logger.error(
      { userId: user.id, via, error: error.message },
      "Failed to send password change alert"
    );
  }
};

const INVALID_REFRESH_MESSAGE = "Invalid or expired refresh token";

const rotatedRecently = (record) =>
  Boolean(
    record?.rotatedAt &&
      Date.now() - record.rotatedAt.getTime() <= env.REFRESH_TOKEN_GRACE_MS
  );

const refresh = async (input) => {
  const tokenHash = hashRefreshToken(input.refreshToken);
  const record = await refreshTokenRepository.findByHash(tokenHash);

  if (!record || !record.user) {
    audit("REFRESH_FAILED", { reason: "NOT_FOUND" });
    throw ApiError.unauthorized(INVALID_REFRESH_MESSAGE, "INVALID_REFRESH_TOKEN");
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await refreshTokenRepository.revokeFamily(record.familyId);
    audit("REFRESH_FAILED", { userId: record.user.id, reason: "EXPIRED" });
    throw ApiError.unauthorized(INVALID_REFRESH_MESSAGE, "INVALID_REFRESH_TOKEN");
  }

  if (record.revokedAt) {
    // A just-rotated token can be presented by a second tab whose request was
    // already in flight. Do not revoke the family for this benign race; the
    // browser has already received the successor cookie from the winner.
    if (rotatedRecently(record)) {
      audit("REFRESH_RACE", { userId: record.user.id });
      throw ApiError.conflict(
        "Session refresh already in progress; retry with the updated cookie",
        "REFRESH_RACE"
      );
    }

    await refreshTokenRepository.revokeFamily(record.familyId);
    audit("REFRESH_TOKEN_REUSE_DETECTED", {
      userId: record.user.id,
      familyId: record.familyId,
    });
    throw ApiError.unauthorized(
      "Refresh token has been revoked",
      "REFRESH_TOKEN_REUSED"
    );
  }

  const rotated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: now, rotatedAt: now },
    });

    if (claimed.count !== 1) return { raced: true };

    const nextRefreshToken = generateRefreshToken();
    const nextTokenHash = hashRefreshToken(nextRefreshToken);

    await tx.refreshToken.create({
      data: {
        userId: record.userId,
        tokenHash: nextTokenHash,
        familyId: record.familyId,
        expiresAt: refreshTokenExpiry(),
      },
    });

    await tx.refreshToken.update({
      where: { id: record.id },
      data: { replacedByTokenHash: nextTokenHash },
    });

    return { raced: false, token: nextRefreshToken };
  });

  if (rotated.raced) {
    const latest = await refreshTokenRepository.findByHash(tokenHash);
    if (rotatedRecently(latest)) {
      audit("REFRESH_RACE", { userId: record.user.id });
      throw ApiError.conflict(
        "Session refresh already in progress; retry with the updated cookie",
        "REFRESH_RACE"
      );
    }

    await refreshTokenRepository.revokeFamily(record.familyId);
    audit("REFRESH_TOKEN_REUSE_DETECTED", {
      userId: record.user.id,
      familyId: record.familyId,
    });
    throw ApiError.unauthorized(
      "Refresh token has been revoked",
      "REFRESH_TOKEN_REUSED"
    );
  }

  const accessToken = signAccessToken(record.user);
  audit("TOKEN_REFRESHED", { userId: record.user.id });

  return {
    user: toPublicUser(record.user),
    accessToken,
    refreshToken: rotated.token,
  };
};

const logout = async (refreshToken) => {
  if (!refreshToken) return { message: "Logged out" };

  const record = await refreshTokenRepository.findByHash(
    hashRefreshToken(refreshToken)
  );

  if (record) {
    await refreshTokenRepository.revokeFamily(record.familyId);
    audit("LOGOUT", { userId: record.userId });
  }

  return { message: "Logged out" };
};

const PASSWORD_RESET_ACK =
  "If the account exists, a password reset code has been sent";

const forgotPassword = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  if (user) {
    // Delivery runs in the background so response latency does not reveal
    // whether the address is registered.
    await issueOtp(user, OTP_PURPOSES.PASSWORD_RESET, { awaitDelivery: false });
  } else {
    // Comparable hashing work for unknown addresses keeps response timing
    // similar to the registered-account path.
    await hashOtp(generateOtp());
  }

  return { message: PASSWORD_RESET_ACK };
};

const resetPassword = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);
  const record = await otpRepository.findLatestActive(
    email,
    OTP_PURPOSES.PASSWORD_RESET
  );

  await verifyOtpRecord({
    user,
    record,
    otp: input.otp,
    errorMessage: "Invalid or expired reset code",
    failureEvent: "PASSWORD_RESET_FAILED",
  });

  const passwordHash = await hashPassword(input.newPassword);
  await userRepository.updatePassword(user.id, passwordHash);
  await refreshTokenRepository.revokeAllForUser(user.id);
  audit("PASSWORD_RESET_SUCCESS", { userId: user.id });
  await sendPasswordChangedAlert(user, "PASSWORD_RESET");

  return { message: "Password has been reset" };
};

module.exports = {
  register,
  login,
  getMe,
  getNotificationPreferences,
  updateNotificationPreferences,
  verifyEmail,
  resendOtp,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};
