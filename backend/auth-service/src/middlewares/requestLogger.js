const { randomUUID } = require("crypto");
const pinoHttp = require("pino-http");

const logger = require("../config/logger");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const resolveRequestId = (req) => {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)) {
    return incoming;
  }
  return randomUUID();
};

module.exports = pinoHttp({
  logger,
  genReqId: resolveRequestId,
  autoLogging: {
    ignore: (req) => req.url === "/api/v1/health" || req.url === "/api/v1/ready",
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
  customProps: (req) => ({ requestId: req.id, ip: req.ip }),
});
