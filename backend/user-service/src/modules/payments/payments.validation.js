const { z } = require("zod");
const { isValidAmount, toAmountString } = require("../wallets/money");

const isChapaAmount = (amount) => {
  if (!isValidAmount(amount)) return false;
  const normalized = toAmountString(amount);
  const [whole, fraction] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  return cents >= 100n && cents <= BigInt(Number.MAX_SAFE_INTEGER);
};

const depositSchema = z
  .object({
    amount: z
      .string()
      .refine(
        isChapaAmount,
        "Amount must be at least 1.00 ETB and fit Chapa's integer-cent limit"
      ),
  })
  .strict();

const withdrawalSchema = z
  .object({
    amount: z
      .string()
      .refine(
        isValidAmount,
        "Amount must be a positive decimal with at most two places"
      ),
  })
  .strict();

module.exports = { depositSchema, withdrawalSchema };
