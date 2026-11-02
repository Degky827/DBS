const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const ApiResponse = require("../../utils/ApiResponse");
const prisma = require("../../config/database");
const metrics = require("../../utils/metrics");

router.get(ROUTES.HEALTH, (req, res) => {
  return ApiResponse.success(
    res,
    {
      service: "kyc-service",
      status: "healthy",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    "Service is healthy"
  );
});

router.get(ROUTES.READY, async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    metrics.markReady(true);
    return ApiResponse.success(
      res,
      { service: "kyc-service", status: "ready" },
      "Service is ready"
    );
  } catch {
    metrics.markReady(false);
    return ApiResponse.error(res, 503, "Service is not ready");
  }
});

module.exports = router;
