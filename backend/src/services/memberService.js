'use strict';

/**
 * Member read-models and invitation acceptance (onboarding).
 * Admin-only mutations live in memberManagementService.js.
 */
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/database');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const { hashPassword } = require('../utils/password');
const userRepository = require('../repositories/userRepository');
const invitationRepository = require('../repositories/invitationRepository');
const audit = require('./auditService');
const authService = require('./authService');
const realtime = require('./realtimeService');
const { EVENTS } = require('../constants/events');

const hashInvitationToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const toMember = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.created_at, updatedAt: u.updated_at,
});

const toInvitation = (i) => ({
  id: i.id, name: i.name, email: i.email, role: i.role, expiresAt: i.expires_at, createdAt: i.created_at,
});

/** Admin view: active members and pending invitations of the caller's organization. */
async function listMembers(ctx) {
  const [members, invitations] = await Promise.all([
    userRepository.listActive(pool, ctx.organizationId),
    invitationRepository.listPending(pool, ctx.organizationId),
  ]);
  return { members: members.map(toMember), invitations: invitations.map(toInvitation) };
}

/** Lightweight directory (id, name, role) for assignee pickers/filters - any role. */
async function directory(ctx) {
  const members = await userRepository.listActive(pool, ctx.organizationId);
  return members.map((m) => ({ id: m.id, name: m.name, role: m.role }));
}

function readToken(input) {
  return validate(input).string('token', { min: 20, max: 200 }).result().token;
}

const INVALID_INVITATION = () => AppError.notFound('Invitation is invalid, already used or has expired');

/** Unauthenticated: shows who is being invited to which organization. */
async function previewInvitation(input) {
  const token = readToken(input);
  const invitation = await invitationRepository.findValidByTokenHash(pool, hashInvitationToken(token));
  if (!invitation) throw INVALID_INVITATION();
  return {
    name: invitation.name,
    email: invitation.email,
    role: invitation.role,
    organizationName: invitation.organization_name,
    expiresAt: invitation.expires_at,
  };
}

/**
 * Accepts an invitation: creates (or re-activates) the member account with the chosen
 * password. The organization comes from the invitation row, never from the request.
 */
async function acceptInvitation(input, { ip }) {
  const token = readToken(input);
  const data = validate(input).password('password').string('name', { required: false, max: 100 }).result();
  const passwordHash = await hashPassword(data.password);

  const user = await withTransaction(async (client) => {
    const inv = await invitationRepository.findValidByTokenHash(client, hashInvitationToken(token), { forUpdate: true });
    if (!inv) throw INVALID_INVITATION();

    const existing = await userRepository.findByEmail(client, inv.organization_id, inv.email);
    if (existing && existing.is_active) {
      throw AppError.conflict('A member with this email already exists', 'EMAIL_EXISTS');
    }

    const fields = {
      organizationId: inv.organization_id, name: data.name || inv.name, passwordHash, role: inv.role,
    };
    const created = existing
      ? await userRepository.reactivate(client, { ...fields, userId: existing.id })
      : await userRepository.create(client, { ...fields, email: inv.email });

    await invitationRepository.markAccepted(client, inv.organization_id, inv.id);
    await audit.record(client, { organizationId: inv.organization_id, userId: created.id, ip }, {
      eventType: audit.AUDIT.INVITATION_ACCEPTED,
      entityType: 'user',
      entityId: created.id,
      newValue: { invitationId: inv.id, email: created.email, role: created.role },
    });
    return { ...created, organization_name: inv.organization_name };
  });

  realtime.emit([realtime.toOrg(user.organization_id, EVENTS.MEMBERS_CHANGED, { reason: 'member_joined' })]);
  return { user: authService.toPublicUser(user), token: authService.issueToken(user) };
}

module.exports = {
  listMembers, directory, previewInvitation, acceptInvitation, hashInvitationToken, toMember, toInvitation,
};
