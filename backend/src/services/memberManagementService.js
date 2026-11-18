'use strict';

/**
 * Admin-only member management: invite, change role, remove, revoke invitation.
 * Every operation is scoped to ctx.organizationId (derived from the authenticated user).
 */
const crypto = require('crypto');
const { withTransaction } = require('../config/database');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const { ALL_ROLES, ROLES } = require('../constants/roles');
const { EVENTS } = require('../constants/events');
const userRepository = require('../repositories/userRepository');
const invitationRepository = require('../repositories/invitationRepository');
const ticketRepository = require('../repositories/ticketRepository');
const audit = require('./auditService');
const realtime = require('./realtimeService');
const { hashInvitationToken, toMember, toInvitation } = require('./memberService');

async function inviteMember(ctx, input) {
  const data = validate(input)
    .string('name', { min: 1, max: 100 })
    .email('email')
    .oneOf('role', ALL_ROLES)
    .result();

  const rawToken = crypto.randomBytes(32).toString('base64url');

  const invitation = await withTransaction(async (client) => {
    const existing = await userRepository.findByEmail(client, ctx.organizationId, data.email);
    if (existing && existing.is_active) {
      throw AppError.conflict('A member with this email already exists in your organization', 'EMAIL_EXISTS');
    }
    // Re-inviting the same email replaces the previous open invitation.
    await invitationRepository.revokeOpenByEmail(client, ctx.organizationId, data.email);
    const expiresAt = new Date(Date.now() + env.invitationExpiresHours * 3600 * 1000);
    const inv = await invitationRepository.create(client, {
      organizationId: ctx.organizationId,
      name: data.name,
      email: data.email,
      role: data.role,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      invitedBy: ctx.userId,
    });
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.MEMBER_INVITED,
      entityType: 'invitation',
      entityId: inv.id,
      newValue: { email: inv.email, role: inv.role, expiresAt: inv.expires_at },
    });
    return inv;
  });

  const result = { invitation: toInvitation(invitation) };
  // Development/demo only: there is no email service, so hand the link to the admin.
  // The token travels in the URL fragment so it never reaches server/proxy logs.
  if (!env.isProduction) result.invitationUrl = `${env.frontendUrl}/accept-invite#token=${rawToken}`;
  return result;
}

async function revokeInvitation(ctx, invitationId) {
  const revoked = await withTransaction(async (client) => {
    const inv = await invitationRepository.revoke(client, ctx.organizationId, invitationId);
    if (!inv) throw AppError.notFound('Invitation not found');
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.INVITATION_REVOKED, entityType: 'invitation', entityId: inv.id,
      oldValue: { email: inv.email, role: inv.role },
    });
    return inv;
  });
  return toInvitation(revoked);
}

/** Locks admins + target, returns the target or throws 404 (also for other organizations). */
async function lockTargetWithAdmins(client, ctx, memberId) {
  const adminIds = await userRepository.lockActiveAdmins(client, ctx.organizationId);
  const target = await userRepository.findByIdForUpdate(client, ctx.organizationId, memberId);
  if (!target || !target.is_active) throw AppError.notFound('Member not found');
  return { target, adminIds };
}

function assertNotLastAdmin(target, adminIds, message) {
  if (target.role === ROLES.ADMIN && adminIds.length <= 1) {
    throw AppError.conflict(message, 'LAST_ADMIN');
  }
}

function ticketRefreshEvents(organizationId, ticketIds) {
  return ticketIds.map((id) => realtime.toOrg(organizationId, EVENTS.TICKET_UPDATED, { id }));
}

async function changeRole(ctx, memberId, input) {
  const { role } = validate(input).oneOf('role', ALL_ROLES).result();

  const outcome = await withTransaction(async (client) => {
    const { target, adminIds } = await lockTargetWithAdmins(client, ctx, memberId);
    if (target.role === role) return { member: target, unassigned: [] };
    if (role !== ROLES.ADMIN) {
      assertNotLastAdmin(target, adminIds, 'The organization must keep at least one admin');
    }
    const updated = await userRepository.updateRole(client, ctx.organizationId, memberId, role);
    // Viewers cannot work tickets, so release anything assigned to a member demoted to viewer.
    const unassigned = role === ROLES.VIEWER
      ? await ticketRepository.unassignAllForUser(client, ctx.organizationId, memberId)
      : [];
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.MEMBER_ROLE_CHANGED, entityType: 'user', entityId: memberId,
      oldValue: { role: target.role }, newValue: { role, unassignedTicketIds: unassigned },
    });
    return { member: updated, unassigned };
  });

  realtime.emit([
    realtime.toOrg(ctx.organizationId, EVENTS.MEMBERS_CHANGED, { reason: 'role_changed', userId: memberId }),
    ...ticketRefreshEvents(ctx.organizationId, outcome.unassigned),
  ]);
  return { member: toMember(outcome.member), unassignedTicketIds: outcome.unassigned };
}

/**
 * Soft-removes a member: deactivates the account, bumps token_version (kills all JWTs),
 * clears their ticket assignments and disconnects their sockets. Tickets are never deleted.
 */
async function removeMember(ctx, memberId) {
  const outcome = await withTransaction(async (client) => {
    const { target, adminIds } = await lockTargetWithAdmins(client, ctx, memberId);
    assertNotLastAdmin(target, adminIds, 'You cannot remove the last admin of the organization');
    await userRepository.deactivate(client, ctx.organizationId, memberId);
    const unassigned = await ticketRepository.unassignAllForUser(client, ctx.organizationId, memberId);
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.MEMBER_REMOVED, entityType: 'user', entityId: memberId,
      oldValue: { email: target.email, role: target.role }, newValue: { unassignedTicketIds: unassigned },
    });
    return { unassigned };
  });

  realtime.disconnectUser(memberId);
  realtime.emit([
    realtime.toOrg(ctx.organizationId, EVENTS.MEMBERS_CHANGED, { reason: 'member_removed', userId: memberId }),
    ...ticketRefreshEvents(ctx.organizationId, outcome.unassigned),
  ]);
  return { id: memberId, unassignedTicketIds: outcome.unassigned };
}

module.exports = {
  inviteMember, revokeInvitation, changeRole, removeMember,
};
