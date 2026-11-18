'use strict';

/**
 * Standard response envelope used by every endpoint:
 * { success, message, data, error, errorCode, timestamp }
 */
function success(res, { statusCode = 200, message = 'Operation completed successfully', data = null } = {}) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    error: null,
    errorCode: null,
    timestamp: new Date().toISOString(),
  });
}

function failure(res, {
  statusCode = 500, message = 'Something went wrong', errorCode = 'INTERNAL_ERROR', error = null,
} = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
    error,
    errorCode,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { success, failure };
