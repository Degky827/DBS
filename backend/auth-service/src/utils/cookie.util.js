const env = require("../config/env");

const parseCookies = (header = "") => {
  const cookies = {};
  if (typeof header !== "string" || !header) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
};

const serializeCookie = (name, value, options) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path}`);
  parts.push(`Max-Age=${options.maxAge}`);
  parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  parts.push("Priority=High");
  return parts.join("; ");
};

const refreshCookieOptions = () => ({
  path: env.REFRESH_COOKIE_PATH,
  maxAge: Math.floor(env.REFRESH_TOKEN_TTL_MS / 1000),
  sameSite: env.REFRESH_COOKIE_SAME_SITE
    ? env.REFRESH_COOKIE_SAME_SITE[0].toUpperCase() + env.REFRESH_COOKIE_SAME_SITE.slice(1)
    : "Lax",
  secure: env.COOKIE_SECURE,
});

const readRefreshToken = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[env.REFRESH_COOKIE_NAME];
  return typeof token === "string" && token ? token : null;
};

const setRefreshCookie = (res, token) => {
  res.append(
    "Set-Cookie",
    serializeCookie(env.REFRESH_COOKIE_NAME, token, refreshCookieOptions())
  );
};

const clearRefreshCookie = (res) => {
  res.append(
    "Set-Cookie",
    serializeCookie(env.REFRESH_COOKIE_NAME, "", {
      ...refreshCookieOptions(),
      maxAge: 0,
    })
  );
};

module.exports = {
  parseCookies,
  readRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
};
