const { z } = require("zod");

const NAME_PATTERN = /^[A-Za-zÀ-ÿ' -]+$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

const requiredString = (label) =>
  z.string({
    error: (issue) =>
      issue.input === undefined
        ? `${label} is required`
        : `${label} must be a string`,
  });

const nameField = (label) =>
  requiredString(label)
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(60, `${label} must not exceed 60 characters`)
    .regex(
      NAME_PATTERN,
      `${label} may only contain letters, spaces, hyphens and apostrophes`
    );

const emailField = requiredString("email")
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email("email must be a valid email address")
      .max(254, "email must not exceed 254 characters")
  );

const registerSchema = z.object({
  firstName: nameField("firstName"),
  lastName: nameField("lastName"),
  email: emailField,
  password: requiredString("password")
    .min(8, "password must be at least 8 characters")
    .max(72, "password must not exceed 72 characters")
    .regex(
      PASSWORD_PATTERN,
      "password must contain at least one uppercase letter, one lowercase letter and one number"
    ),
});

const loginSchema = z.object({
  email: emailField,
  password: requiredString("password")
    .min(1, "password is required")
    .max(72, "password must not exceed 72 characters"),
});

module.exports = { registerSchema, loginSchema };
