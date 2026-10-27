const { z } = require("zod");

const createSubmissionSchema = z.object({}).strict();

module.exports = { createSubmissionSchema };
