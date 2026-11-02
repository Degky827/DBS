const ApiError = require("./ApiError");

// validate() only parses bodies; list endpoints need the same flattened field
// errors for query strings.
const parseQuery = (schema, query) => {
  const result = schema.safeParse(query);
  if (result.success) return result.data;

  const errors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_query";
    if (!errors[key]) errors[key] = issue.message;
  }
  throw ApiError.validation(errors);
};

module.exports = { parseQuery };
