const router = require("express").Router();

const env = require("../../config/env");
const healthRoutes = require("./health.routes");
const docsRoutes = require("./docs.routes");
const authRoutes = require("../../modules/auth/auth.routes");
const usersRoutes = require("../../modules/users/users.routes");
const walletsRoutes = require("../../modules/wallets/wallets.routes");
const transactionsRoutes = require("../../modules/transactions/transactions.routes");
const paymentsRoutes = require("../../modules/payments/payments.routes");

router.use("/", healthRoutes);

if (env.ENABLE_API_DOCS) {
  router.use(docsRoutes);
}

router.use("/", authRoutes);
router.use("/", usersRoutes);
router.use("/", walletsRoutes);
router.use("/", transactionsRoutes);
router.use("/", paymentsRoutes);

module.exports = router;
