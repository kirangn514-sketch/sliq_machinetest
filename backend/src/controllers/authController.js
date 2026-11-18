'use strict';

/**
 * Auth endpoints. Controllers only translate HTTP <-> service calls.
 */
const authService = require('../services/authService');
const memberService = require('../services/memberService');
const { success } = require('../utils/response');
const { setAuthCookie, clearAuthCookie, issueCsrfCookie } = require('../utils/cookies');

async function signup(req, res) {
  const { user, token } = await authService.signup(req.body, { ip: req.ip });
  setAuthCookie(res, token);
  return success(res, { statusCode: 201, message: 'Organization created', data: { user } });
}

async function login(req, res) {
  const { user, token } = await authService.login(req.body, { ip: req.ip });
  setAuthCookie(res, token);
  return success(res, { message: 'Logged in', data: { user } });
}

async function logout(req, res) {
  if (req.ctx) await authService.recordLogout(req.ctx);
  clearAuthCookie(res);
  return success(res, { message: 'Logged out' });
}

async function me(req, res) {
  const { user } = req;
  return success(res, {
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization: { id: user.organizationId, name: user.organizationName },
      },
    },
  });
}

/** Issues (rotates) the CSRF cookie; the SPA calls this once on load. */
async function csrf(req, res) {
  issueCsrfCookie(res);
  return success(res, { message: 'CSRF cookie issued' });
}

async function previewInvitation(req, res) {
  const data = await memberService.previewInvitation(req.body);
  return success(res, { data });
}

async function acceptInvitation(req, res) {
  const { user, token } = await memberService.acceptInvitation(req.body, { ip: req.ip });
  setAuthCookie(res, token);
  return success(res, { statusCode: 201, message: 'Invitation accepted', data: { user } });
}

module.exports = {
  signup, login, logout, me, csrf, previewInvitation, acceptInvitation,
};
