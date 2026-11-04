const ApiError = require("./ApiError");

const flattenIssues = (issues) => {
  const errors = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join(".") : "_query";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
};

// `validate` middleware parses request bodies only; query strings need their
// own parse step so GET handlers receive coerced values.
const parseQuery = (schema, query) => {
  const result = schema.safeParse(query || {});
  if (!result.success) {
    throw ApiError.validation(flattenIssues(result.error.issues));
  }
  return result.data;
};

module.exports = { parseQuery };
