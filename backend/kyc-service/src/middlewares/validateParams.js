const ApiError = require("../utils/ApiError");

module.exports = function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});

    if (!result.success) {
      const errors = result.error.flatten();
      return next(ApiError.validation(errors.fieldErrors || errors.formErrors || errors));
    }

    req.params = result.data;
    return next();
  };
};
