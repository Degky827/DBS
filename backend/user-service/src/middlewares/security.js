const helmet = require("helmet");
const compression = require("compression");

const securityMiddlewares = [
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
  compression(),
];

module.exports = securityMiddlewares;
