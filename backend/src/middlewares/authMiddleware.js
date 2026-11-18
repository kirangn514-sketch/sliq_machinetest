'use strict';

/**
 * Authenticates the request from the HttpOnly JWT cookie and loads the CURRENT user
 * state from the database (role, active flag, token version). Implements a sliding
 * session: once more than half of the token lifetime has elapsed, a fresh cookie is issued.
 */
const env = require('../config/env');
const AppError = require('../utils/AppError');
const authService = require('../services/authService');
const { setAuthCookie } = require('../utils/cookies');

async function authenticate(req, res, next) {
  const token = req.cookies ? req.cookies[env.cookie.name] : undefined;
  if (!token) return next(AppError.unauthorized());

  const { user, claims } = await authService.resolveSession(token);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (claims.exp - nowSeconds < (claims.exp - claims.iat) / 2) {
    setAuthCookie(res, authService.issueToken(user));
  }

  req.user = {
    id: user.id,
    organizationId: user.organization_id,
    organizationName: user.organization_name,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  return next();
}

/** Like authenticate, but never fails (used by logout so stale cookies can still be cleared). */
async function optionalAuthenticate(req, res, next) {
  try {
    await authenticate(req, res, () => {});
  } catch (err) {
    req.user = undefined;
  }
  return next();
}

module.exports = { authenticate, optionalAuthenticate };
