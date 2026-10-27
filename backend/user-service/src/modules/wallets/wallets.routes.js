const router = require("express").Router();

const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const walletsController = require("./wallets.controller");

router.post(ROUTES.WALLETS.ROOT, authenticate, walletsController.createWallet);
router.get(ROUTES.WALLETS.ME, authenticate, walletsController.getMyWallet);
router.get(ROUTES.WALLETS.BY_ID, authenticate, walletsController.getWalletById);

module.exports = router;