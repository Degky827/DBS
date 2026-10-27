const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,16})(?:\.\d{1,2})?$/;
const MAX_AMOUNT_CENTS = 9999999999999999999n;

const isValidAmount = (value) => {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents > 0n && cents <= MAX_AMOUNT_CENTS;
};

const toAmountString = (value) => {
  if (!isValidAmount(value)) {
    throw new TypeError("Amount must be a positive decimal with at most two places");
  }
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
};

module.exports = { isValidAmount, toAmountString };