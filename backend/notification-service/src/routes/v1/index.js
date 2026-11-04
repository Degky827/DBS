const router = require("express").Router();

const healthRoutes = require("./health.routes");
const notificationRoutes = require("./notification.routes");
const internalRoutes = require("./internal.routes");

router.use("/", healthRoutes);
router.use("/", notificationRoutes);
router.use("/", internalRoutes);

module.exports = router;
