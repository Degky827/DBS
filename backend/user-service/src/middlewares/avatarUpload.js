const multer = require("multer");
const ApiError = require("../utils/ApiError");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter(req, file, callback) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return callback(
        ApiError.badRequest(
          "Avatar must be a PNG, JPEG, or WebP image",
          "INVALID_AVATAR_TYPE"
        )
      );
    }

    return callback(null, true);
  },
}).single("avatar");

module.exports = (req, res, next) => {
  upload(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(
          ApiError.badRequest(
            "Avatar image must be 5 MB or smaller",
            "AVATAR_TOO_LARGE"
          )
        );
      }

      return next(
        ApiError.badRequest(
          "Upload one image using the avatar field",
          "INVALID_AVATAR_UPLOAD"
        )
      );
    }

    return next(error);
  });
};
