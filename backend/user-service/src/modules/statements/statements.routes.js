const router = require("express").Router();

const ApiResponse = require("../../utils/ApiResponse");
const { parseQuery } = require("../../utils/query");
const ROUTES = require("../../constants/routes");
const authenticate = require("../../middlewares/authenticate");
const usersService = require("../users/users.service");
const statements = require("./statements.service");
const { buildStatementPdf } = require("./statements.pdf");
const { statementQuerySchema } = require("./statements.validation");

const isoDay = (date) => date.toISOString().slice(0, 10);

const resolveRange = (query) => {
  const to = query.to || isoDay(new Date());
  const from = query.from || isoDay(new Date(Date.parse(`${to}T00:00:00.000Z`) - 29 * 86400000));
  return { from, to };
};

const getStatement = async (req, res) => {
  const query = parseQuery(statementQuerySchema, req.query);
  const userId = await usersService.getResolvedUserId(req.user);
  const result = await statements.getStatement(userId, resolveRange(query));
  return ApiResponse.success(res, result, "Statement generated");
};

const exportStatement = async (req, res) => {
  const query = parseQuery(statementQuerySchema, req.query);
  const userId = await usersService.getResolvedUserId(req.user);
  const statement = await statements.getStatement(userId, resolveRange(query));
  const pdf = buildStatementPdf(statement);

  res.set("Content-Type", "application/pdf");
  res.set(
    "Content-Disposition",
    `attachment; filename="statement-${statement.period.from}-${statement.period.to}.pdf"`
  );
  res.set("Content-Length", String(pdf.length));
  res.set("Cache-Control", "no-store");
  return res.send(pdf);
};

router.get(ROUTES.STATEMENTS.ROOT, authenticate, getStatement);
router.get(ROUTES.STATEMENTS.EXPORT_PDF, authenticate, exportStatement);

module.exports = router;
