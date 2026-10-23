const { z } = require("zod");

const requiredString = (label) =>
  z.string({
    error: (issue) =>
      issue.input === undefined
        ? `${label} is required`
        : `${label} must be a string`,
  });

const emailField = requiredString("email")
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("email must be a valid email address")
      .max(254, "email must not exceed 254 characters")
  );

const devLoginSchema = z
  .object({
    email: emailField,
    password: requiredString("password")
      .min(1, "password is required")
      .max(72, "password must not exceed 72 characters"),
  })
  .strict();

module.exports = {
  devLoginSchema,
};
