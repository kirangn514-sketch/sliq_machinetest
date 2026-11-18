'use strict';

/**
 * Centralised role authorization, e.g. authorizeRoles('admin', 'agent').
 * Coarse-grained only: fine-grained rules (ticket ownership etc.) live in the services.
 */
const AppError = require('../utils/AppError');
const { ALL_ROLES } = require('../constants/roles');

function authorizeRoles(...allowed) {
  allowed.forEach((role) => {
    if (!ALL_ROLES.includes(role)) throw new Error(`Unknown role in authorizeRoles: ${role}`);
  });
  return (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!allowed.includes(req.user.role)) return next(AppError.forbidden());
    return next();
  };
}

module.exports = { authorizeRoles };
