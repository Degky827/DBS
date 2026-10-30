const ApiError = require("../utils/ApiError");

module.exports = function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});

    if (!result.success) {
      const errors = result.error.flatten();
      return next(
        ApiError.validation(errors.fieldErrors || errors.formErrors || errors)
      );
    }

    req.reviewQuery = result.data;
    return next();
  };
};
