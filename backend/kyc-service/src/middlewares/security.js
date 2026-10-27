const helmet = require("helmet");
const compression = require("compression");

module.exports = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https:"],
      },
    },
  }),
  compression(),
];
