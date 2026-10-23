const env = require("../../config/env");
const userRepository = require("../../repositories/user.repository");
const devSessionRepository = require("../../repositories/devSession.repository");
const ApiError = require("../../utils/ApiError");
const audit = require("../../utils/audit");
const {
  comparePassword,
  DUMMY_HASH,
} = require("../../utils/password.util");
const {
  generateDevSessionToken,
  hashDevSessionToken,
  devSessionExpiry,
} = require("../../utils/token.util");

const devLogin = async (input) => {
  const email = input.email.toLowerCase();
  const user = await userRepository.findByEmail(email);

  const isPasswordValid = await comparePassword(
    input.password,
    user ? user.passwordHash : DUMMY_HASH
  );

  if (!user || !isPasswordValid) {
    audit("DEV_LOGIN_FAILED", { email });
    throw ApiError.unauthorized(
      "Invalid email or password",
      "INVALID_CREDENTIALS"
    );
  }

  const token = generateDevSessionToken();
  await devSessionRepository.create({
    userId: user.id,
    tokenHash: hashDevSessionToken(token),
    expiresAt: devSessionExpiry(),
  });

  audit("DEV_LOGIN_SUCCESS", { userId: user.id });

  return {
    token,
    tokenType: "Bearer",
    expiresInMs: env.DEV_SESSION_TTL_MS,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
    },
    warning:
      "Development session only. Not production-ready. Replace with auth-service JWT integration.",
  };
};

const devLogout = async (req) => {
  if (req.session) {
    await devSessionRepository.revoke(req.session.id);
    audit("DEV_LOGOUT", { userId: req.user.id });
  }

  return { message: "Development session revoked" };
};

module.exports = { devLogin, devLogout };
