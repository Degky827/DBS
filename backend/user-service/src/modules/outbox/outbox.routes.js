const router = require("express").Router();
const { z } = require("zod");

const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const requireRole = require("../../middlewares/requireRole");
const outbox = require("./outbox.service");

const listQuerySchema = z
  .object({
    status: z.enum(["pending", "published", "failed", "all"]).default("pending"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();

const listOutboxEvents = async (req, res) => {
  const result = await outbox.listEvents(parseQuery(listQuerySchema, req.query));
  return ApiResponse.success(res, result, "Outbox events fetched");
};

const replayOutboxEvent = async (req, res) => {
  const event = await outbox.replay(req.params.eventId);
  return ApiResponse.success(res, { event }, "Outbox event queued for replay");
};

router.get(ROUTES.ADMIN.OUTBOX, authenticate, requireRole("ADMIN"), listOutboxEvents);
router.post(ROUTES.ADMIN.OUTBOX_REPLAY, authenticate, requireRole("ADMIN"), replayOutboxEvent);

module.exports = router;
