const kycEligibility = require("../services/kycEligibility");

// Must run after authenticate so req.user.id is the verified identity. In JWT
// mode this is the auth-service subject that kyc-service stores on submissions
// (the local UserProfile id is a different identifier).
//
// The resolved status is handed to the handler on req.kyc: the tier limits the
// money paths clamp with belong to that same subject, and resolving them again
// from the financial user id would read a different KYC record.
module.exports = function requireKycApproval(req, res, next) {
  kycEligibility
    .assertApproved(req.user.id)
    .then((kyc) => {
      req.kyc = kyc;
      next();
    })
    .catch(next);
};
