'use strict';

/**
 * Builds the immutable request context consumed by services.
 * organizationId comes ONLY from the authenticated identity; any organization id the
 * client sends in the body is stripped so it can never reach business logic by accident.
 */
const AppError = require('../utils/AppError');

const TENANT_KEYS = ['organizationId', 'organization_id', 'orgId'];

function tenantContext(req, res, next) {
  if (!req.user || !Number.isInteger(req.user.organizationId)) return next(AppError.unauthorized());

  if (req.body && typeof req.body === 'object') {
    TENANT_KEYS.forEach((key) => { delete req.body[key]; });
  }

  req.ctx = Object.freeze({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    role: req.user.role,
    name: req.user.name,
    ip: req.ip,
  });
  return next();
}

module.exports = { tenantContext };
