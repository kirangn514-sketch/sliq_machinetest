'use strict';

/**
 * Invitation data access. Only token hashes are stored or queried.
 */

const COLUMNS = `i.id, i.organization_id, i.name, i.email, i.role, i.expires_at, i.invited_by,
  i.accepted_at, i.revoked_at, i.created_at`;

async function create(db, {
  organizationId, name, email, role, tokenHash, expiresAt, invitedBy,
}) {
  const { rows } = await db.query(
    `INSERT INTO invitations (organization_id, name, email, role, token_hash, expires_at, invited_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, organization_id, name, email, role, expires_at, invited_by, created_at`,
    [organizationId, name, email, role, tokenHash, expiresAt, invitedBy],
  );
  return rows[0];
}

/** Revokes any still-open invitation for the same email (used when re-inviting). */
async function revokeOpenByEmail(db, organizationId, email) {
  const { rowCount } = await db.query(
    `UPDATE invitations SET revoked_at = NOW()
      WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [organizationId, email],
  );
  return rowCount;
}

async function revoke(db, organizationId, invitationId) {
  const { rows } = await db.query(
    `UPDATE invitations i SET revoked_at = NOW()
      WHERE i.organization_id = $1 AND i.id = $2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      RETURNING ${COLUMNS}`,
    [organizationId, invitationId],
  );
  return rows[0] || null;
}

async function listPending(db, organizationId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM invitations i
      WHERE i.organization_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > NOW()
      ORDER BY i.created_at DESC`,
    [organizationId],
  );
  return rows;
}

/**
 * Token lookup for the (unauthenticated) accept flow. The organization is derived
 * from the invitation row itself - never from client input.
 */
async function findValidByTokenHash(db, tokenHash, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}, o.name AS organization_name
       FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > NOW()
      ${forUpdate ? 'FOR UPDATE OF i' : ''}`,
    [tokenHash],
  );
  return rows[0] || null;
}

async function markAccepted(db, organizationId, invitationId) {
  await db.query(
    'UPDATE invitations SET accepted_at = NOW() WHERE organization_id = $1 AND id = $2',
    [organizationId, invitationId],
  );
}

module.exports = {
  create, revokeOpenByEmail, revoke, listPending, findValidByTokenHash, markAccepted,
};
