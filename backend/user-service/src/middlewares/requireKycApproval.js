const kycEligibility = require("../services/kycEligibility");

// Must run after authenticate so req.user.id is the verified identity. In JWT
// mode this is the auth-service subject that kyc-service stores on submissions
// (the local UserProfile id is a different identifier).
module.exports = function requireKycApproval(req, res, next) {
  kycEligibility.assertApproved(req.user.id).then(() => next()).catch(next);
};
