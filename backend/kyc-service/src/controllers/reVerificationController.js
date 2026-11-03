const reVerificationService = require("../services/reVerificationService");
const ApiResponse = require("../utils/ApiResponse");

async function myTasks(req, res) {
  const tasks = await reVerificationService.listTasks({
    userId: req.user.id,
    status: req.reviewQuery.status,
    limit: req.reviewQuery.limit,
  });
  return ApiResponse.success(res, { tasks }, "Re-verification tasks fetched");
}

async function queue(req, res) {
  const tasks = await reVerificationService.officerQueue(req.reviewQuery);
  return ApiResponse.success(res, { tasks }, "Re-verification queue fetched");
}

async function stats(req, res) {
  const summary = await reVerificationService.taskStats();
  return ApiResponse.success(res, summary, "Re-verification statistics fetched");
}

async function waive(req, res) {
  const task = await reVerificationService.waiveTask({
    taskId: req.params.taskId,
    actorId: req.user.id,
    reason: req.body.reason,
  });
  return ApiResponse.success(res, { task }, "Re-verification task waived");
}

module.exports = { myTasks, queue, stats, waive };
