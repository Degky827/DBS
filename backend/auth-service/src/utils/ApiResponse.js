const ApiResponse = {
  success(res, data = null, message = "OK", statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  },

  error(res, statusCode, message, errors = null) {
    const payload = { success: false, message };
    if (errors) payload.errors = errors;
    return res.status(statusCode).json(payload);
  },
};

module.exports = ApiResponse;
