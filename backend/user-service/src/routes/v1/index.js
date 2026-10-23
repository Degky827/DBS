const router = require("express").Router();

const env = require("../../config/env");
const healthRoutes = require("./health.routes");
const docsRoutes = require("./docs.routes");
const authRoutes = require("../../modules/auth/auth.routes");
const usersRoutes = require("../../modules/users/users.routes");

router.use("/", healthRoutes);

if (env.ENABLE_API_DOCS) {
  router.use(docsRoutes);
}

router.use("/", authRoutes);
router.use("/", usersRoutes);

module.exports = router;
