'use strict';

/**
 * User data access. Every query except the login lookup is scoped by organization_id.
 * password_hash is only ever selected by the functions that need it for authentication.
 */

const PUBLIC_COLUMNS = `u.id, u.organization_id, u.name, u.email, u.role, u.is_active,
  u.created_at, u.updated_at`;

async function create(db, {
  organizationId, name, email, passwordHash, role,
}) {
  const { rows } = await db.query(
    `INSERT INTO users (organization_id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, organization_id, name, email, role, is_active, token_version, created_at, updated_at`,
    [organizationId, name, email, passwordHash, role],
  );
  return rows[0];
}

/** Reactivates a previously removed member (same org + email) with fresh credentials. */
async function reactivate(db, {
  organizationId, userId, name, passwordHash, role,
}) {
  const { rows } = await db.query(
    `UPDATE users
        SET name = $3, password_hash = $4, role = $5, is_active = TRUE,
            deactivated_at = NULL, token_version = token_version + 1
      WHERE organization_id = $1 AND id = $2
      RETURNING id, organization_id, name, email, role, is_active, token_version, created_at, updated_at`,
    [organizationId, userId, name, passwordHash, role],
  );
  return rows[0] || null;
}

/**
 * Login lookup: email is unique per organization, so one email may map to several
 * accounts in different organizations. Returns all active candidates with their hashes.
 */
async function findActiveCredentialsByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT u.id, u.organization_id, u.name, u.email, u.role, u.token_version, u.password_hash,
            o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
      WHERE u.email = $1 AND u.is_active
      ORDER BY u.id`,
    [email],
  );
  return rows;
}

/** Used by auth middleware / socket auth on every request. */
async function findAuthContext(db, organizationId, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.organization_id, u.name, u.email, u.role, u.is_active, u.token_version,
            o.name AS organization_name
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
      WHERE u.organization_id = $1 AND u.id = $2`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

async function findById(db, organizationId, userId) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.organization_id = $1 AND u.id = $2`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

async function findByIdForUpdate(db, organizationId, userId) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.organization_id = $1 AND u.id = $2 FOR UPDATE`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

async function findByEmail(db, organizationId, email) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.organization_id = $1 AND u.email = $2`,
    [organizationId, email],
  );
  return rows[0] || null;
}

async function listActive(db, organizationId) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users u
      WHERE u.organization_id = $1 AND u.is_active
      ORDER BY u.name, u.id`,
    [organizationId],
  );
  return rows;
}

async function listActiveIds(db, organizationId) {
  const { rows } = await db.query(
    'SELECT id FROM users WHERE organization_id = $1 AND is_active',
    [organizationId],
  );
  return rows.map((r) => r.id);
}

/** Locks all active admins of the organization (serialises "last admin" checks). */
async function lockActiveAdmins(db, organizationId) {
  const { rows } = await db.query(
    `SELECT id FROM users
      WHERE organization_id = $1 AND role = 'admin' AND is_active
      ORDER BY id
      FOR UPDATE`,
    [organizationId],
  );
  return rows.map((r) => r.id);
}

async function updateRole(db, organizationId, userId, role) {
  const { rows } = await db.query(
    `UPDATE users u SET role = $3
      WHERE u.organization_id = $1 AND u.id = $2 AND u.is_active
      RETURNING ${PUBLIC_COLUMNS}`,
    [organizationId, userId, role],
  );
  return rows[0] || null;
}

/** Soft-deletes a member and bumps token_version so every issued JWT is rejected. */
async function deactivate(db, organizationId, userId) {
  const { rows } = await db.query(
    `UPDATE users u
        SET is_active = FALSE, deactivated_at = NOW(), token_version = u.token_version + 1
      WHERE u.organization_id = $1 AND u.id = $2 AND u.is_active
      RETURNING ${PUBLIC_COLUMNS}`,
    [organizationId, userId],
  );
  return rows[0] || null;
}

/** True if any account (in any organization, active or removed) uses this email. */
async function emailExistsInAnyOrganization(db, email) {
  const { rows } = await db.query(
    'SELECT EXISTS (SELECT 1 FROM users WHERE email = $1) AS found',
    [email],
  );
  return rows[0].found;
}

module.exports = {
  create,
  emailExistsInAnyOrganization,
  reactivate,
  findActiveCredentialsByEmail,
  findAuthContext,
  findById,
  findByIdForUpdate,
  findByEmail,
  listActive,
  listActiveIds,
  lockActiveAdmins,
  updateRole,
  deactivate,
};
