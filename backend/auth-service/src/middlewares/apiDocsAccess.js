const crypto = require("crypto");

const env = require("../config/env");
const ApiError = require("../utils/ApiError");

const basicCredentials = (header) => {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
};

const timingSafeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = function apiDocsAccess(req, res, next) {
  if (!env.IS_PRODUCTION) return next();

  if (!env.API_DOCS_USERNAME || !env.API_DOCS_PASSWORD) {
    return next(ApiError.notFound("API documentation is not available", "DOCS_DISABLED"));
  }

  const credentials = basicCredentials(req.headers.authorization);
  const valid =
    credentials &&
    timingSafeEqual(credentials.username, env.API_DOCS_USERNAME) &&
    timingSafeEqual(credentials.password, env.API_DOCS_PASSWORD);

  if (!valid) {
    res.setHeader("WWW-Authenticate", 'Basic realm="API documentation", charset="UTF-8"');
    return next(
      ApiError.unauthorized("Documentation credentials required", "DOCS_AUTH_REQUIRED")
    );
  }

  return next();
};
