const ApiError = require("../utils/ApiError");

module.exports = function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params || {});

    if (!result.success) {
      const errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path.length ? issue.path.join(".") : "_params";
        if (!errors[key]) errors[key] = issue.message;
      }
      return next(ApiError.validation(errors));
    }

    req.params = result.data;
    return next();
  };
};
