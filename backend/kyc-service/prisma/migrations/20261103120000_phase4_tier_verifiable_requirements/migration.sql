-- The tier engine counts a required profile field as satisfied only when the
-- identity-document comparison proves it, and that comparison covers firstName,
-- lastName and dateOfBirth (see src/services/comparisonService.js). The sample
-- tiers seeded with the Phase 4 schema also asked for contact and funding-source
-- fields that no check in this service produces, so every applicant would have
-- landed on "an officer must attest" instead of a machine-readable decision.
--
-- The seeded policy now expresses the differences a real check can see -
-- document count, document type and liveness - and keeps the provable fields.
-- A deployment that adds evidence for another field (a selfie address proof, an
-- OCR'd source-of-funds document) can put it back in requiredFields; until then
-- it is reported as an unverified requirement rather than assumed satisfied.
UPDATE "KycTierDefinition"
   SET "requiredFields" = '["firstName", "lastName", "dateOfBirth"]'::jsonb
 WHERE "id" IN ('tier-def-sample-tier-1', 'tier-def-sample-tier-2', 'tier-def-sample-tier-3')
   AND "requiredFields" IS DISTINCT FROM '["firstName", "lastName", "dateOfBirth"]'::jsonb;
