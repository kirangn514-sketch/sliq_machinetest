'use strict';

/**
 * Authentication: organization signup, login, session resolution.
 */
const { pool, withTransaction } = require('../config/database');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken, verifyToken } = require('../utils/jwt');
const { ROLES } = require('../constants/roles');
const organizationRepository = require('../repositories/organizationRepository');
const userRepository = require('../repositories/userRepository');
const slaRepository = require('../repositories/slaRepository');
const audit = require('./auditService');

/** Shape returned to clients - never includes hashes or token versions. */
function toPublicUser(user, organizationName) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organization: { id: user.organization_id, name: organizationName || user.organization_name },
  };
}

function issueToken(user) {
  return signToken({ userId: user.id, organizationId: user.organization_id, tokenVersion: user.token_version });
}

async function signup(input, { ip }) {
  const data = validate(input)
    .string('organizationName', { min: 2, max: 150 })
    .string('name', { min: 1, max: 100 })
    .email('email')
    .password('password')
    .result();

  const passwordHash = await hashPassword(data.password);

  const { user, organization } = await withTransaction(async (client) => {
    const org = await organizationRepository.create(client, { name: data.organizationName });
    const admin = await userRepository.create(client, {
      organizationId: org.id,
      name: data.name,
      email: data.email,
      passwordHash,
      role: ROLES.ADMIN,
    });
    await slaRepository.createDefault(client, org.id, env.sla.defaultMinutes);
    await audit.record(client, { organizationId: org.id, userId: admin.id, ip }, {
      eventType: audit.AUDIT.ORG_SIGNUP,
      entityType: 'organization',
      entityId: org.id,
      newValue: { organizationName: org.name, adminUserId: admin.id, adminEmail: admin.email },
    });
    return { user: admin, organization: org };
  });

  return { user: toPublicUser(user, organization.name), token: issueToken(user) };
}

/**
 * Email is unique per organization, so the same email may exist in several organizations.
 * We only consider accounts whose password matches; if more than one matches, the client
 * must choose (organizationId is used purely to pick among accounts the credentials unlock).
 */
async function login(input, { ip }) {
  const data = validate(input)
    .email('email')
    .string('password', { min: 1, max: 200, trim: false })
    .integer('organizationId', { required: false })
    .result();

  const candidates = await userRepository.findActiveCredentialsByEmail(pool, data.email);

  let matches = [];
  if (candidates.length === 0) {
    await verifyPassword(data.password, null); // constant-ish timing
  } else {
    const results = await Promise.all(candidates.map((c) => verifyPassword(data.password, c.password_hash)));
    matches = candidates.filter((_, i) => results[i]);
  }

  if (data.organizationId) matches = matches.filter((m) => m.organization_id === data.organizationId);

  if (matches.length === 0) {
    await audit.record(pool, { ip }, {
      eventType: audit.AUDIT.LOGIN_FAILED, entityType: 'user', newValue: { email: data.email },
    });
    throw AppError.unauthorized('Invalid email or password');
  }

  if (matches.length > 1) {
    throw AppError.conflict(
      'This email belongs to several organizations. Please choose one.',
      'ORGANIZATION_SELECTION_REQUIRED',
      { organizations: matches.map((m) => ({ id: m.organization_id, name: m.organization_name })) },
    );
  }

  const user = matches[0];
  await audit.record(pool, { organizationId: user.organization_id, userId: user.id, ip }, {
    eventType: audit.AUDIT.LOGIN_SUCCESS, entityType: 'user', entityId: user.id,
  });
  return { user: toPublicUser(user), token: issueToken(user) };
}

/**
 * Verifies a JWT and re-loads the user from the database so that role changes,
 * removals (is_active) and forced logouts (token_version) take effect immediately.
 * Used by BOTH the REST auth middleware and the Socket.IO handshake.
 */
async function resolveSession(token) {
  let claims;
  try {
    claims = verifyToken(token);
  } catch (err) {
    throw AppError.unauthorized('Session expired or invalid');
  }
  const user = await userRepository.findAuthContext(pool, claims.organizationId, claims.userId);
  if (!user || !user.is_active || user.token_version !== claims.tokenVersion) {
    throw AppError.unauthorized('Session is no longer valid');
  }
  return { user, claims };
}

async function recordLogout(ctx) {
  await audit.record(pool, ctx, { eventType: audit.AUDIT.LOGOUT, entityType: 'user', entityId: ctx.userId });
}

module.exports = {
  signup, login, resolveSession, issueToken, toPublicUser, recordLogout,
};
