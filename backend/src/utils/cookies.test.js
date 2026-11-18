'use strict';

const { withEnv } = require('../testUtils/factories');

function loadCookies(envOverrides = {}) {
  let mod;
  withEnv(envOverrides, () => {
    jest.isolateModules(() => {
      jest.doMock('./jwt', () => ({ tokenLifetimeMs: () => 3600000 }));
      mod = require('./cookies');
    });
  });
  return mod;
}

const fakeRes = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });

describe('auth cookie', () => {
  it('is HttpOnly, SameSite=Lax and not Secure outside production', () => {
    // Arrange
    const cookies = loadCookies();
    const res = fakeRes();
    // Act
    cookies.setAuthCookie(res, 'jwt-value');
    // Assert
    expect(res.cookie).toHaveBeenCalledWith('sliqdesk_token', 'jwt-value', {
      httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 3600000,
    });
  });

  it('is Secure in production', () => {
    const cookies = loadCookies({ NODE_ENV: 'production' });
    const res = fakeRes();
    cookies.setAuthCookie(res, 't');
    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
  });

  it('honours an explicit COOKIE_SECURE override', () => {
    const cookies = loadCookies({ NODE_ENV: 'production', COOKIE_SECURE: 'false' });
    const res = fakeRes();
    cookies.setAuthCookie(res, 't');
    expect(res.cookie.mock.calls[0][2].secure).toBe(false);
  });

  it('is cleared with matching attributes on logout', () => {
    const cookies = loadCookies();
    const res = fakeRes();
    cookies.clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith('sliqdesk_token', expect.objectContaining({ httpOnly: true, path: '/' }));
  });
});

describe('csrf cookie', () => {
  it('issues a random, JS-readable, SameSite=Strict token', () => {
    // Arrange
    const cookies = loadCookies();
    const res = fakeRes();
    // Act
    const a = cookies.issueCsrfCookie(res);
    const b = cookies.issueCsrfCookie(res);
    // Assert
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(res.cookie).toHaveBeenCalledWith('sliqdesk_csrf', a, expect.objectContaining({ httpOnly: false, sameSite: 'strict' }));
  });
});
