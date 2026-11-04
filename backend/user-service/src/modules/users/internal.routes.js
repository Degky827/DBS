const router = require("express").Router();

const ApiError = require("../../utils/ApiError");
const ApiResponse = require("../../utils/ApiResponse");
const ROUTES = require("../../constants/routes");
const authenticateInternal = require("../../middlewares/authenticateInternal");
const usersService = require("./users.service");
const { contactParamsSchema } = require("./users.validation");

const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params || {});
  if (!result.success) {
    return next(ApiError.validation(result.error.flatten().fieldErrors));
  }
  req.params = result.data;
  return next();
};

const getContact = async (req, res) => {
  const contact = await usersService.getContact(req.params.userId);
  return ApiResponse.success(res, { contact }, "Contact fetched");
};

// Notification delivery needs an address for a customer the caller only knows
// by id. The shared key keeps this off the public surface.
router.get(
  ROUTES.INTERNAL.USER_CONTACT,
  authenticateInternal,
  validateParams(contactParamsSchema),
  getContact
);

module.exports = router;
