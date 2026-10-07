const router = require("express").Router();

const healthRoutes = require("./health.routes");
const authRoutes = require("../../modules/auth/auth.routes");

router.use("/", healthRoutes);
router.use("/auth", authRoutes);

module.exports = router;
