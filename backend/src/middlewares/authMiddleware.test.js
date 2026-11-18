'use strict';

jest.mock('../services/authService');
jest.mock('../utils/cookies');

const authService = require('../services/authService');
const { setAuthCookie } = require('../utils/cookies');
const { authenticate, optionalAuthenticate } = require('./authMiddleware');
const AppError = require('../utils/AppError');
const { httpDoubles, userRow } = require('../testUtils/factories');

const now = () => Math.floor(Date.now() / 1000);

describe('authenticate', () => {
  it('rejects requests without the auth cookie', async () => {
    // Arrange
    const { req, res, next } = httpDoubles();
    // Act
    await authenticate(req, res, next);
    // Assert
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(authService.resolveSession).not.toHaveBeenCalled();
  });

  it('loads the CURRENT user from the database into req.user', async () => {
    // Arrange
    const { req, res, next } = httpDoubles({ cookies: { sliqdesk_token: 'tok' } });
    authService.resolveSession.mockResolvedValue({
      user: userRow({ role: 'agent' }), claims: { iat: now(), exp: now() + 3600 },
    });
    // Act
    await authenticate(req, res, next);
    // Assert
    expect(authService.resolveSession).toHaveBeenCalledWith('tok');
    expect(req.user).toEqual({
      id: 10, organizationId: 1, organizationName: 'Org A', name: 'Alice', email: 'alice@example.com', role: 'agent',
    });
    expect(next).toHaveBeenCalledWith();
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  it('renews the cookie once more than half the lifetime has elapsed (sliding session)', async () => {
    const { req, res, next } = httpDoubles({ cookies: { sliqdesk_token: 'tok' } });
    authService.resolveSession.mockResolvedValue({
      user: userRow(), claims: { iat: now() - 3000, exp: now() + 600 },
    });
    authService.issueToken.mockReturnValue('fresh');
    await authenticate(req, res, next);
    expect(setAuthCookie).toHaveBeenCalledWith(res, 'fresh');
  });

  it('propagates invalid-session errors', async () => {
    const { req, res, next } = httpDoubles({ cookies: { sliqdesk_token: 'bad' } });
    authService.resolveSession.mockRejectedValue(AppError.unauthorized('Session is no longer valid'));
    await expect(authenticate(req, res, next)).rejects.toMatchObject({ statusCode: 401 });
    expect(req.user).toBeUndefined();
  });

  it('treats a missing cookie jar as unauthenticated', async () => {
    const { req, res, next } = httpDoubles();
    req.cookies = undefined;
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
  });
});

describe('optionalAuthenticate', () => {
  it('sets req.user when the session is valid', async () => {
    const { req, res, next } = httpDoubles({ cookies: { sliqdesk_token: 'tok' } });
    authService.resolveSession.mockResolvedValue({ user: userRow(), claims: { iat: now(), exp: now() + 3600 } });
    await optionalAuthenticate(req, res, next);
    expect(req.user.id).toBe(10);
    expect(next).toHaveBeenCalledWith();
  });

  it('never fails, so stale cookies can still be cleared on logout', async () => {
    const { req, res, next } = httpDoubles({ cookies: { sliqdesk_token: 'expired' } });
    authService.resolveSession.mockRejectedValue(new Error('expired'));
    await optionalAuthenticate(req, res, next);
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
