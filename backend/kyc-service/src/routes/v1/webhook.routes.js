const router = require("express").Router();
const webhookController = require("../../controllers/webhookController");

router.post("/didit", webhookController.receiveDidit);

module.exports = router;
