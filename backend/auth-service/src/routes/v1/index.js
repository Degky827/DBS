const router = require("express").Router();

const healthRoutes = require("./health.routes");

router.use("/", healthRoutes);

module.exports = router;
