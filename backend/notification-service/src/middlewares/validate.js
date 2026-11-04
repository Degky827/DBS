const ApiError = require("../utils/ApiError");

const toFieldErrors = (issues) => {
  const errors = {};

  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!errors[key]) {
      errors[key] = issue.message;
    }
  }

  return errors;
};

module.exports = function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});

    if (!result.success) {
      return next(ApiError.validation(toFieldErrors(result.error.issues)));
    }

    req.body = result.data;
    return next();
  };
};
