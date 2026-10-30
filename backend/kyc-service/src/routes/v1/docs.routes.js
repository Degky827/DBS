const router = require("express").Router();
const swaggerUi = require("swagger-ui-express");

const apiDocsAccess = require("../../middlewares/apiDocsAccess");
const apiDocsSecurity = require("../../middlewares/apiDocsSecurity");

const spec = {
  openapi: "3.0.0",
  info: {
    title: "KYC Service API",
    version: "1.0.0",
    description: "Backend API for KYC document verification and review",
  },
  servers: [{ url: "/api/v1/kyc" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          200: { description: "Service healthy" },
        },
      },
    },
    "/submissions": {
      post: {
        summary: "Create a KYC submission for the authenticated customer",
        security: [{ bearerAuth: [] }],
        responses: {
          201: { description: "Submission created" },
          401: { description: "Missing, invalid, or expired access token" },
          503: { description: "Registered profile service unavailable" },
        },
      },
    },
    "/status": {
      get: {
        summary: "Get the authenticated customer's latest KYC status",
        description:
          "Returns the latest submission with document metadata, provider check outcomes, and lifecycle timestamps. `submittedAt` is recorded when a provider result moves the submission into review and cleared when a new verification attempt starts; `reviewedAt` is recorded by the officer decision.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Latest submission status" },
          401: { description: "Missing, invalid, or expired access token" },
          404: { description: "No KYC submission found" },
        },
      },
    },
    "/submissions/{submissionId}/documents": {
      post: {
        summary: "Upload an encrypted identity document and extract OCR text",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["document", "documentType"],
                properties: {
                  document: { type: "string", format: "binary" },
                  documentType: {
                    type: "string",
                    enum: ["passport", "national_id", "drivers_license", "residence_permit"],
                  },
                  side: { type: "string", enum: ["front", "back"] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Uploaded, encrypted, and OCR processed" },
          400: { description: "Invalid image or request fields" },
          401: { description: "Missing, invalid, or expired access token" },
          413: { description: "Document exceeds the configured upload size" },
        },
      },
    },
    "/documents/{documentId}": {
      get: {
        summary: "Retrieve OCR fields for an owned document",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "OCR fields, confidence, and correction state" },
          404: { description: "Document not found" },
        },
      },
      delete: {
        summary: "Delete an owned document and its encrypted file",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Document deleted" } },
      },
    },
    "/documents/{documentId}/content": {
      get: {
        summary: "Retrieve an owned document image",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Decrypted image; private and not cacheable" } },
      },
    },
    "/documents/{documentId}/corrections": {
      patch: {
        summary: "Correct OCR-extracted fields for an owned document",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Corrected fields saved" } },
      },
    },
    "/submissions/{submissionId}/verification-session": {
      post: {
        summary: "Create or reuse a Didit hosted verification session",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Hosted verification session URL" },
          503: { description: "Didit is not configured or temporarily unavailable" },
        },
      },
    },
    "/submissions/{submissionId}/compare": {
      post: {
        summary: "Compare corrected OCR fields with user-service registered profile fields",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Field-level match, mismatch, or review-required outcomes" },
          503: { description: "Registered profile service unavailable" },
        },
      },
    },
    "/officer/reviews": {
      get: {
        summary: "List KYC submissions awaiting an authorized officer",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Review queue" },
          403: { description: "Officer role required" },
        },
      },
    },
    "/officer/submissions/{submissionId}/decision": {
      post: {
        summary: "Approve or reject a submission with a reason",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Decision recorded" },
          403: { description: "Officer role required or self-review prohibited" },
          409: { description: "Approval requirements not met or invalid state" },
        },
      },
    },
    "/webhooks/didit": {
      post: {
        summary: "Receive signed Didit session, entity, activity, and transaction events",
        description:
          "Validates the signed body timestamp and HMAC, atomically stores a deduplicated event, and returns 202 after persistence. The unsigned X-Timestamp header is not used for freshness.",
        responses: {
          202: { description: "Webhook durably accepted or duplicate ignored" },
          400: { description: "Invalid webhook JSON or event" },
          401: { description: "Invalid signature or stale signed body timestamp" },
          503: { description: "Webhook signature verification is not configured" },
        },
      },
    },
  },
};

// In production documentation is disabled by default and, when explicitly
// enabled, requires HTTP Basic credentials. The relaxed Swagger CSP applies
// only to these routes, never to application endpoints.
router.get("/openapi.json", apiDocsAccess, apiDocsSecurity, (req, res) => {
  return res.json(spec);
});

router.use(
  "/docs",
  apiDocsAccess,
  apiDocsSecurity,
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: "KYC Service API",
    explorer: false,
  })
);

module.exports = router;
// Exposed for tooling/CI that validates the inline specification.
module.exports.spec = spec;
