const ApiError = require("../utils/ApiError");

module.exports = function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const errors = result.error.flatten();
      return next(ApiError.validation(errors.fieldErrors || errors.formErrors || errors));
    }

    req.body = result.data;
    return next();
  };
};
