const helmet = require("helmet");

// Swagger UI requires inline bootstrap scripts and styles. The exception is
// scoped to documentation routes only and is never applied to application
// endpoints. Documentation is disabled by default in production and protected
// with HTTP Basic authentication when explicitly enabled.
module.exports = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
});
