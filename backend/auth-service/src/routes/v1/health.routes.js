const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const ApiResponse = require("../../utils/ApiResponse");

router.get(ROUTES.HEALTH, (req, res) => {
  return ApiResponse.success(
    res,
    {
      service: "auth-service",
      status: "healthy",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    "Service is healthy"
  );
});

module.exports = router;
