const { z } = require("zod");

const codeField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "code must be a 6-digit authenticator code")
  .optional();

const recoveryCodeField = z
  .string()
  .trim()
  .min(6, "recoveryCode is too short")
  .max(32, "recoveryCode is too long")
  .optional();

const factor = (schema) =>
  schema
    .strict()
    .refine((data) => Boolean(data.code) !== Boolean(data.recoveryCode), {
      message: "Provide either code or recoveryCode",
      path: ["code"],
    });

const confirmSchema = z.object({ code: codeField.unwrap() }).strict();

const verifySchema = factor(
  z.object({
    mfaToken: z.string().trim().min(20).max(4096),
    code: codeField,
    recoveryCode: recoveryCodeField,
  })
);

const stepUpSchema = factor(
  z.object({
    code: codeField,
    recoveryCode: recoveryCodeField,
  })
);

const disableSchema = z
  .object({
    password: z.string().min(1).max(72),
    code: codeField,
    recoveryCode: recoveryCodeField,
  })
  .strict()
  .refine((data) => Boolean(data.code) !== Boolean(data.recoveryCode), {
    message: "Provide either code or recoveryCode",
    path: ["code"],
  });

module.exports = {
  confirmSchema,
  verifySchema,
  stepUpSchema,
  disableSchema,
};
