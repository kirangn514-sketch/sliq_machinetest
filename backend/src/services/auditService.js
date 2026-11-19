'use strict';

/**
 * Thin wrapper over the append-only audit log so services share one call shape.
 * Always call inside the business transaction so the audit row commits atomically.
 */
const auditRepository = require('../repositories/auditRepository');

const AUDIT = Object.freeze({
  ORG_SIGNUP: 'ORGANIZATION_SIGNUP',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  MEMBER_INVITED: 'MEMBER_INVITED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_UPDATED: 'TICKET_UPDATED',
  COMMENT_CREATED: 'COMMENT_CREATED',
  SLA_SETTINGS_UPDATED: 'SLA_SETTINGS_UPDATED',
  SLA_BREACHED: 'SLA_BREACHED',
  DEMO_DATA_SEEDED: 'DEMO_DATA_SEEDED',
});

/** ctx = { organizationId, userId, ip } (any may be null for system/unauthenticated events). */
function record(db, ctx, {
  eventType, entityType, entityId = null, oldValue = null, newValue = null,
}) {
  return auditRepository.insert(db, {
    organizationId: ctx.organizationId || null,
    eventType,
    entityType,
    entityId,
    performedBy: ctx.userId || null,
    oldValue,
    newValue,
    ipAddress: ctx.ip || null,
  });
}

module.exports = { AUDIT, record };
