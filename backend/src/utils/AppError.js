'use strict';

/** Operational error carrying an HTTP status and a stable machine-readable code. */
class AppError extends Error {
  constructor(statusCode, message, errorCode, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errorCode = errorCode || 'ERROR';
    this.details = details || null;
  }

  static badRequest(message, details) {
    return new AppError(400, message, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message, 'UNAUTHORIZED');
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppError(403, message, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, message, 'NOT_FOUND');
  }

  static conflict(message, errorCode = 'CONFLICT', details) {
    return new AppError(409, message, errorCode, details);
  }
}

module.exports = AppError;
