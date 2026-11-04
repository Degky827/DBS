const tierService = require("../services/tierService");
const ApiResponse = require("../utils/ApiResponse");

async function list(req, res) {
  const definitions = await tierService.listDefinitions();
  return ApiResponse.success(
    res,
    {
      definitions,
      // Tier policy is operator-configured sample data until a deployment sets
      // its own definitions, so callers must not read these limits as a
      // statement about any regulator's rules.
      notice:
        "Tier requirements and limits come from the tier definitions configured for this deployment.",
    },
    "KYC tiers fetched"
  );
}

async function current(req, res) {
  const [tier, history] = await Promise.all([
    tierService.effectiveTier(req.user.id),
    tierService.assignmentHistory(req.user.id, { limit: 10 }),
  ]);
  return ApiResponse.success(
    res,
    {
      ...tier,
      history,
      openRequest: history.find((row) => row.status === "REQUESTED") || null,
    },
    "Current KYC tier fetched"
  );
}

async function createRequest(req, res) {
  const result = await tierService.requestTierChange({
    userId: req.user.id,
    tierCode: req.body.tierCode,
    reason: req.body.reason,
  });
  return ApiResponse.success(res, result, "KYC tier request submitted for review", 201);
}

async function myRequests(req, res) {
  const history = await tierService.assignmentHistory(req.user.id, {
    limit: 50,
  });
  return ApiResponse.success(res, { requests: history }, "Tier requests fetched");
}

async function qualification(req, res) {
  const result = await tierService.qualificationFor(req.params.submissionId);
  return ApiResponse.success(res, result, "Submission tier qualification fetched");
}

async function requestQueue(req, res) {
  const requests = await tierService.listRequests(req.reviewQuery);
  return ApiResponse.success(res, { requests }, "Tier requests fetched");
}

async function decideRequest(req, res) {
  const result = await tierService.decideRequest({
    assignmentId: req.params.assignmentId,
    actorId: req.user.id,
    decision: req.body.decision,
    decisionReason: req.body.decisionReason,
  });
  return ApiResponse.success(res, result, "Tier request decision recorded");
}

async function definitions(req, res) {
  const [rows, summary] = await Promise.all([
    tierService.listDefinitions({ includeInactive: true }),
    tierService.tierSummary(),
  ]);
  return ApiResponse.success(
    res,
    { definitions: rows, holders: summary },
    "Tier definitions fetched"
  );
}

async function createVersion(req, res) {
  const tier = await tierService.createTierVersion({
    ...req.body,
    actorId: req.user.id,
  });
  return ApiResponse.success(res, tier, "Tier definition version created", 201);
}

async function activate(req, res) {
  const tier = await tierService.setDefinitionActive({
    tierId: req.params.tierId,
    actorId: req.user.id,
  });
  return ApiResponse.success(res, tier, "Tier definition activated");
}

async function retire(req, res) {
  const result = await tierService.retireDefinition({
    tierId: req.params.tierId,
    actorId: req.user.id,
  });
  return ApiResponse.success(res, result, "Tier definition retired");
}

async function updateLimits(req, res) {
  const tier = await tierService.updateTierLimits({
    tierId: req.params.tierId,
    limits: req.body.limits,
    actorId: req.user.id,
  });
  return ApiResponse.success(res, tier, "Tier limits updated");
}

async function assignments(req, res) {
  const history = await tierService.assignmentHistory(req.reviewQuery.userId, {
    limit: req.reviewQuery.limit,
  });
  return ApiResponse.success(
    res,
    { userId: req.reviewQuery.userId, assignments: history },
    "Tier assignment history fetched"
  );
}

module.exports = {
  list,
  current,
  createRequest,
  myRequests,
  qualification,
  requestQueue,
  decideRequest,
  definitions,
  createVersion,
  activate,
  retire,
  updateLimits,
  assignments,
};
