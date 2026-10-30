const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const ApiResponse = require("../../utils/ApiResponse");
const prisma = require("../../config/database");

router.get(ROUTES.HEALTH, (req, res) => {
  return ApiResponse.success(
    res,
    {
      service: "user-service",
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
    return ApiResponse.success(
      res,
      { service: "user-service", status: "ready" },
      "Service is ready"
    );
  } catch {
    return ApiResponse.error(res, 503, "Service is not ready");
  }
});

module.exports = router;
