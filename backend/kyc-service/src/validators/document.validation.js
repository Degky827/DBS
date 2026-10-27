const { z } = require("zod");

const documentTypeSchema = z.enum([
  "passport",
  "national_id",
  "drivers_license",
  "residence_permit",
]);

const sideSchema = z.enum(["front", "back"]).optional();

const uploadDocumentSchema = z.object({
  documentType: documentTypeSchema,
  side: sideSchema,
}).strict();

const correctionSchema = z.object({
  fields: z.array(
    z.object({
      key: z.string().min(1).max(80),
      value: z.string().max(500),
    }).strict()
  ).min(1).max(100),
}).strict();

module.exports = { uploadDocumentSchema, correctionSchema };
