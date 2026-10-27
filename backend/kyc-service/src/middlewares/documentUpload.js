const multer = require("multer");
const env = require("../config/env");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_BYTES,
    files: 1,
    fields: 4,
    parts: 5,
  },
  fileFilter(req, file, callback) {
    const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!supportedTypes.includes(file.mimetype)) {
      const error = new Error("Unsupported document format");
      error.code = "UNSUPPORTED_DOCUMENT_FORMAT";
      return callback(error);
    }
    return callback(null, true);
  },
});

module.exports = upload;
