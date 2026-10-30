const helmet = require("helmet");
const compression = require("compression");

const env = require("../config/env");

// JSON API responses do not need to load any subresources. Swagger routes
// install a separately scoped, relaxed policy (see apiDocsSecurity).
const apiContentSecurityPolicy = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    baseUri: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'none'"],
    objectSrc: ["'none'"],
    scriptSrc: ["'none'"],
    styleSrc: ["'none'"],
    imgSrc: ["'none'"],
    fontSrc: ["'none'"],
    connectSrc: ["'none'"],
    mediaSrc: ["'none'"],
    workerSrc: ["'none'"],
    manifestSrc: ["'none'"],
  },
};

const securityMiddlewares = [
  helmet({
    contentSecurityPolicy: apiContentSecurityPolicy,
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
    xFrameOptions: { action: "deny" },
    hsts: env.ENABLE_HSTS
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
  }),
  compression(),
];

module.exports = securityMiddlewares;
