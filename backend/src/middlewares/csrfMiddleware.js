'use strict';

/**
 * CSRF protection for cookie-based auth (double-submit cookie + Origin check).
 *  - Every response ensures a random CSRF cookie exists (readable by the SPA).
 *  - State-changing requests must echo it in the X-CSRF-Token header.
 *  - If the browser sends an Origin header it must be an allowed frontend origin.
 * Combined with SameSite cookies this blocks cross-site form/fetch attacks.
 */
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { issueCsrfCookie } = require('../utils/cookies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function csrfProtection(req, res, next) {
  const cookieToken = req.cookies ? req.cookies[env.cookie.csrfName] : undefined;
  if (!cookieToken) issueCsrfCookie(res);

  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin.replace(/\/$/, ''))) {
    return next(AppError.forbidden('Request origin not allowed'));
  }

  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new AppError(403, 'Invalid or missing CSRF token', 'CSRF_INVALID'));
  }
  return next();
}

module.exports = { csrfProtection };
