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
  generateOtp,
  hashOtp,
  compareOtp,
  otpExpiry,
  OTP_PURPOSES,
} = require("../../utils/otp.util");

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

const issueOtp = async (user, purpose) => {
  const otp = generateOtp();
  await otpRepository.create({
    userId: user.id,
    email: user.email,
    codeHash: await hashOtp(otp),
    purpose,
    expiresAt: otpExpiry(),
  });
  // No mail provider configured yet — OTP is logged so the flow can be tested.
  logger.info({ email: user.email, purpose, otp }, "OTP issued");
  audit("OTP_ISSUED", { userId: user.id, purpose });
  return otp;
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

  const user = await userRepository.create({
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
  });

  await issueEmailVerificationOtp(user);
  audit("REGISTER_SUCCESS", { userId: user.id });

  return { user: toPublicUser(user) };
};

const verifyEmail = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  const record = await otpRepository.findLatestActive(
    email,
    OTP_PURPOSES.EMAIL_VERIFICATION
  );

  const valid =
    user && record && record.expiresAt.getTime() > Date.now()
      ? await compareOtp(input.otp, record.codeHash)
      : false;

  if (!valid) {
    audit("OTP_VERIFY_FAILED", { email });
    throw new ApiError(400, "Invalid or expired verification code", "INVALID_OTP");
  }

  await otpRepository.consume(record.id);
  const updated = await userRepository.markEmailVerified(user.id);
  audit("EMAIL_VERIFIED", { userId: user.id });

  return { user: toPublicUser(updated) };
};

const resendOtp = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  if (!user) {
    return { message: "If the account exists, a new verification code has been sent" };
  }

  if (user.isEmailVerified) {
    throw new ApiError(400, "Email is already verified", "EMAIL_ALREADY_VERIFIED");
  }

  await issueEmailVerificationOtp(user);

  return { message: "If the account exists, a new verification code has been sent" };
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
  audit("LOGIN_SUCCESS", { userId: user.id });

  return { user: toPublicUser(user), accessToken };
};

const getMe = async (userId) => {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw ApiError.notFound("Account not found", "USER_NOT_FOUND");
  }

  return { user: toPublicUser(user) };
};

module.exports = { register, login, getMe, verifyEmail, resendOtp };
