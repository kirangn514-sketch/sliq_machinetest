'use strict';

const AppError = require('./AppError');
const { success, failure } = require('./response');
const { hashPassword, verifyPassword } = require('./password');
const { httpDoubles } = require('../testUtils/factories');

describe('AppError factories', () => {
  it.each([
    ['badRequest', ['bad', { f: 1 }], 400, 'VALIDATION_ERROR', { f: 1 }],
    ['unauthorized', [], 401, 'UNAUTHORIZED', null],
    ['forbidden', [], 403, 'FORBIDDEN', null],
    ['notFound', [], 404, 'NOT_FOUND', null],
    ['conflict', ['dup'], 409, 'CONFLICT', null],
  ])('%s builds the right status and code', (factory, args, status, code, details) => {
    // Act
    const err = AppError[factory](...args);
    // Assert
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(status);
    expect(err.errorCode).toBe(code);
    expect(err.details).toEqual(details);
  });

  it('defaults errorCode to ERROR', () => {
    expect(new AppError(418, 'teapot').errorCode).toBe('ERROR');
  });
});

describe('response envelope', () => {
  it('success() returns the standard shape', () => {
    const { res } = httpDoubles();
    success(res, { statusCode: 201, message: 'Created', data: { id: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      success: true, message: 'Created', data: { id: 1 }, error: null, errorCode: null,
    }));
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('success() has sensible defaults', () => {
    const { res } = httpDoubles();
    success(res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('failure() never includes data and defaults to a generic 500', () => {
    const { res } = httpDoubles();
    failure(res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual(expect.objectContaining({
      success: false, message: 'Something went wrong', data: null, errorCode: 'INTERNAL_ERROR',
    }));
  });
});

describe('password hashing', () => {
  it('hashes with bcrypt and verifies the right password only', async () => {
    // Arrange
    const hash = await hashPassword('Password123');
    // Act + Assert
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(hash).not.toContain('Password123');
    await expect(verifyPassword('Password123', hash)).resolves.toBe(true);
    await expect(verifyPassword('Wrong1234', hash)).resolves.toBe(false);
  });

  it('compares against a dummy hash when no hash exists (timing equaliser)', async () => {
    await expect(verifyPassword('anything1', null)).resolves.toBe(false);
  });
});

describe('logger', () => {
  const load = (level) => {
    let logger;
    jest.isolateModules(() => {
      process.env.LOG_LEVEL = level;
      logger = require('./logger');
    });
    process.env.LOG_LEVEL = 'silent';
    return logger;
  };

  it('writes JSON lines to stdout/stderr by level', () => {
    // Arrange
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = load('debug');
    // Act
    logger.debug('d');
    logger.info('i', { a: 1 });
    logger.warn('w');
    logger.error('e');
    // Assert
    expect(out).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(2);
    expect(JSON.parse(out.mock.calls[1][0])).toEqual(expect.objectContaining({ level: 'info', message: 'i', a: 1 }));
  });

  it('suppresses messages below the threshold', () => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = load('warn');
    logger.info('hidden');
    expect(out).not.toHaveBeenCalled();
  });

  it('defaults to info for unknown levels', () => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = load('nonsense');
    logger.debug('hidden');
    logger.info('shown');
    expect(out).toHaveBeenCalledTimes(1);
  });
});
