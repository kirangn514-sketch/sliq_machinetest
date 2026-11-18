'use strict';

jest.mock('../utils/logger');

const logger = require('../utils/logger');
const { errorHandler, notFoundHandler } = require('./errorMiddleware');
const { authLimiter } = require('./rateLimitMiddleware');
const AppError = require('../utils/AppError');
const { httpDoubles } = require('../testUtils/factories');

function handle(err) {
  const { req, res, next } = httpDoubles();
  errorHandler(err, req, res, next);
  return res;
}

describe('errorHandler', () => {
  it('returns AppError status, message, code and details', () => {
    // Act
    const res = handle(AppError.badRequest('Validation failed', { fields: { a: 'bad' } }));
    // Assert
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual(expect.objectContaining({
      success: false, message: 'Validation failed', errorCode: 'VALIDATION_ERROR', error: { fields: { a: 'bad' } },
    }));
  });

  it('logs 5xx AppErrors', () => {
    handle(new AppError(503, 'down', 'DOWN'));
    expect(logger.error).toHaveBeenCalled();
  });

  it.each([
    ['23505', 409, 'DUPLICATE'],
    ['23503', 400, 'VALIDATION_ERROR'],
    ['23514', 400, 'VALIDATION_ERROR'],
    ['22P02', 400, 'VALIDATION_ERROR'],
    ['22001', 400, 'VALIDATION_ERROR'],
  ])('maps PostgreSQL code %s to %i without leaking SQL', (code, status, errorCode) => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "uq_users_org_email"'), { code });
    const res = handle(err);
    expect(res.statusCode).toBe(status);
    expect(res.body.errorCode).toBe(errorCode);
    expect(JSON.stringify(res.body)).not.toContain('uq_users_org_email');
  });

  it('maps malformed JSON and oversized bodies', () => {
    expect(handle({ type: 'entity.parse.failed' }).statusCode).toBe(400);
    expect(handle({ type: 'entity.too.large' }).statusCode).toBe(413);
  });

  it('hides unknown errors (and unmapped PG codes) behind a generic 500', () => {
    // Arrange
    const err = Object.assign(new Error('connect ECONNREFUSED password=secret'), { code: '08006' });
    // Act
    const res = handle(err);
    // Assert
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Something went wrong');
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack|ECONNREFUSED/);
    expect(logger.error).toHaveBeenCalledWith('Unhandled error', expect.objectContaining({ error: err.message }));
  });

  it('copes with non-Error throwables', () => {
    expect(handle(null).statusCode).toBe(500);
  });
});

describe('notFoundHandler', () => {
  it('returns a 404 envelope', () => {
    const { req, res } = httpDoubles();
    notFoundHandler(req, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.errorCode).toBe('ROUTE_NOT_FOUND');
  });
});

describe('authLimiter', () => {
  it('returns 429 in the standard envelope after the limit', async () => {
    // Arrange: drive the real middleware with the same IP
    const send = async () => {
      const { req, res } = httpDoubles({ method: 'POST' });
      req.app = { get: () => false };
      req.headers = {};
      res.setHeader = jest.fn();
      res.getHeader = jest.fn();
      res.headersSent = false;
      let passed = false;
      await authLimiter(req, res, () => { passed = true; });
      return { passed, res };
    };
    // Act
    const results = [];
    for (let i = 0; i < 21; i += 1) results.push(await send());
    // Assert
    expect(results.slice(0, 20).every((r) => r.passed)).toBe(true);
    expect(results[20].passed).toBe(false);
    expect(results[20].res.statusCode).toBe(429);
    expect(results[20].res.body.errorCode).toBe('RATE_LIMITED');
  });
});
