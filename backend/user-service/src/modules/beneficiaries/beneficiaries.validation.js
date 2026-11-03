const { z } = require("zod");

const beneficiaryFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  nickname: z.string().trim().max(40).optional(),
  accountNumber: z
    .string()
    .trim()
    .min(6, "Account number must be at least 6 characters")
    .max(34)
    .regex(/^[A-Za-z0-9-]+$/, "Account number may only contain letters, digits and dashes"),
  bankName: z.string().trim().min(2).max(80).optional(),
  bankCode: z.string().trim().max(20).optional(),
  destinationWalletId: z.uuid().optional(),
  isFavorite: z.boolean().optional(),
};

const createBeneficiarySchema = z.object(beneficiaryFields).strict();

const updateBeneficiarySchema = z
  .object({
    ...beneficiaryFields,
    name: beneficiaryFields.name.optional(),
    accountNumber: beneficiaryFields.accountNumber.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided");

module.exports = { createBeneficiarySchema, updateBeneficiarySchema };
