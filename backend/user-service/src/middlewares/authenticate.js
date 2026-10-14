const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const { hashDevSessionToken } = require("../utils/token.util");
const devSessionRepository = require("../repositories/devSession.repository");

const DEV_ONLY_MESSAGE =
  "Development session authentication is enabled. This is not production-ready; integrate auth-service JWTs before deployment.";

function requireDevApiKey(req) {
  if (!env.DEV_API_KEY) return;

  const provided = req.headers["x-dev-api-key"];
  if (provided !== env.DEV_API_KEY) {
    throw ApiError.unauthorized("Invalid or missing X-Dev-Api-Key", "INVALID_DEV_API_KEY");
  }
}

module.exports = async function authenticate(req, res, next) {
  try {
    if (env.AUTH_MODE !== "dev") {
      throw ApiError.forbidden(DEV_ONLY_MESSAGE, "AUTH_MODE_UNSUPPORTED");
    }

    requireDevApiKey(req);

    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw ApiError.unauthorized("Authentication token missing", "TOKEN_MISSING");
    }

    const tokenHash = hashDevSessionToken(token.trim());
    const session = await devSessionRepository.findActiveByHash(tokenHash);

    if (
      !session ||
      !session.user ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw ApiError.unauthorized(
        "Invalid or expired development session",
        "INVALID_SESSION"
      );
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id,
      authMode: "dev",
    };
    req.session = session;

    return next();
  } catch (error) {
    return next(error);
  }
};
