'use strict';

jest.mock('../utils/cookies');

const { issueCsrfCookie } = require('../utils/cookies');
const { csrfProtection } = require('./csrfMiddleware');
const { httpDoubles } = require('../testUtils/factories');

const TOKEN = 'a'.repeat(43);

describe('csrfProtection', () => {
  it('issues a CSRF cookie when the client has none', () => {
    // Arrange
    const { req, res, next } = httpDoubles({ method: 'GET' });
    // Act
    csrfProtection(req, res, next);
    // Assert
    expect(issueCsrfCookie).toHaveBeenCalledWith(res);
    expect(next).toHaveBeenCalledWith();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets safe method %s through without a header', (method) => {
    const { req, res, next } = httpDoubles({ method, cookies: { sliqdesk_csrf: TOKEN } });
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(issueCsrfCookie).not.toHaveBeenCalled();
  });

  it('accepts a state-changing request whose header matches the cookie', () => {
    const { req, res, next } = httpDoubles({
      method: 'POST',
      cookies: { sliqdesk_csrf: TOKEN },
      headers: { 'X-CSRF-Token': TOKEN, Origin: 'http://localhost:3000/' },
    });
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ['missing header', { cookies: { sliqdesk_csrf: TOKEN }, headers: {} }],
    ['missing cookie', { cookies: {}, headers: { 'X-CSRF-Token': TOKEN } }],
    ['mismatched token', { cookies: { sliqdesk_csrf: TOKEN }, headers: { 'X-CSRF-Token': 'b'.repeat(43) } }],
    ['different length', { cookies: { sliqdesk_csrf: TOKEN }, headers: { 'X-CSRF-Token': 'short' } }],
  ])('rejects POST with %s', (_label, opts) => {
    // Arrange
    const { req, res, next } = httpDoubles({ method: 'POST', ...opts });
    // Act
    csrfProtection(req, res, next);
    // Assert
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, errorCode: 'CSRF_INVALID' }));
  });

  it('rejects requests from a foreign Origin even with a valid token', () => {
    const { req, res, next } = httpDoubles({
      method: 'DELETE',
      cookies: { sliqdesk_csrf: TOKEN },
      headers: { 'X-CSRF-Token': TOKEN, Origin: 'https://evil.example' },
    });
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, message: 'Request origin not allowed' }));
  });

  it('handles requests without a parsed cookie jar', () => {
    const { req, res, next } = httpDoubles({ method: 'PUT' });
    req.cookies = undefined;
    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'CSRF_INVALID' }));
  });
});
