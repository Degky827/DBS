const router = require("express").Router();

const env = require("../../config/env");
const healthRoutes = require("./health.routes");
const docsRoutes = require("./docs.routes");
const authRoutes = require("../../modules/auth/auth.routes");
const internalRoutes = require("../../modules/internal/internal.routes");

router.use("/", healthRoutes);

if (env.ENABLE_API_DOCS) {
  router.use(docsRoutes);
}

router.use("/auth", authRoutes);
router.use("/internal", internalRoutes);

module.exports = router;
