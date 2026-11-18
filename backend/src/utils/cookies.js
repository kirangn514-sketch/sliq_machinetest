'use strict';

const crypto = require('crypto');
const env = require('../config/env');
const { tokenLifetimeMs } = require('./jwt');

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookie.secure,
    sameSite: 'lax',
    path: '/',
  };
}

function setAuthCookie(res, token) {
  res.cookie(env.cookie.name, token, { ...authCookieOptions(), maxAge: tokenLifetimeMs() });
}

function clearAuthCookie(res) {
  res.clearCookie(env.cookie.name, authCookieOptions());
}

/**
 * CSRF double-submit cookie. Readable by JS (not HttpOnly) so the SPA can echo it
 * in the X-CSRF-Token header; an attacker's site cannot read it.
 */
function issueCsrfCookie(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  res.cookie(env.cookie.csrfName, token, {
    httpOnly: false,
    secure: env.cookie.secure,
    sameSite: 'strict',
    path: '/',
  });
  return token;
}

module.exports = {
  setAuthCookie, clearAuthCookie, issueCsrfCookie,
};
