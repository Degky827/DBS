const ApiResponse = {
  success(res, data = null, message = "OK", statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  },

  error(res, statusCode, message, errors = null, code = null) {
    const payload = { success: false, message };
    if (errors) payload.errors = errors;
    if (code) payload.code = code;
    return res.status(statusCode).json(payload);
  },
};

module.exports = ApiResponse;
