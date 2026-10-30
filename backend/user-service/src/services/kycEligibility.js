const ApiError = require("../utils/ApiError");
const kycClient = require("./kycClient");

let client = kycClient;

// Test seam mirroring setCustomPaymentsService; production always uses kycClient.
const setKycClient = (replacement) => {
  client = replacement || kycClient;
};

// Fails closed: only an explicit isApproved === true allows the operation.
const assertApproved = async (userId) => {
  let result;
  try {
    result = await client.getUserKycStatus(userId);
  } catch {
    throw new ApiError(
      503,
      "KYC status is temporarily unavailable. Please try again later.",
      "KYC_STATUS_UNAVAILABLE"
    );
  }

  if (!result || result.isApproved !== true) {
    throw ApiError.forbidden(
      "KYC approval is required for this operation",
      "KYC_NOT_APPROVED"
    );
  }

  return result;
};

module.exports = { assertApproved, setKycClient };
