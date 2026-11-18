'use strict';

/**
 * Centralised error handling. Clients receive a safe message + errorCode only;
 * stack traces, SQL and driver details are logged server-side, never returned.
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { failure } = require('../utils/response');

/** Maps PostgreSQL error codes to safe HTTP errors. */
function fromPostgres(err) {
  switch (err.code) {
    case '23505': return AppError.conflict('A record with the same unique value already exists', 'DUPLICATE');
    case '23503': return AppError.badRequest('A referenced record does not exist');
    case '23514':
    case '22P02':
    case '22001':
      return AppError.badRequest('Invalid input');
    default: return null;
  }
}

function notFoundHandler(req, res) {
  return failure(res, { statusCode: 404, message: 'Route not found', errorCode: 'ROUTE_NOT_FOUND' });
}

// Express identifies error handlers by their 4-argument signature, so `next` must stay.
function errorHandler(err, req, res, next) {
  let appError = err instanceof AppError ? err : null;

  if (!appError && err && err.type === 'entity.parse.failed') appError = AppError.badRequest('Malformed JSON body');
  if (!appError && err && err.type === 'entity.too.large') appError = new AppError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  if (!appError && err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) appError = fromPostgres(err);

  if (!appError) {
    logger.error('Unhandled error', {
      method: req.method, path: req.originalUrl, error: err && err.message, stack: err && err.stack,
    });
    return failure(res, { statusCode: 500, message: 'Something went wrong', errorCode: 'INTERNAL_ERROR' });
  }

  if (appError.statusCode >= 500) logger.error(appError.message, { path: req.originalUrl });
  return failure(res, {
    statusCode: appError.statusCode,
    message: appError.message,
    errorCode: appError.errorCode,
    error: appError.details,
  });
}

module.exports = { errorHandler, notFoundHandler };
