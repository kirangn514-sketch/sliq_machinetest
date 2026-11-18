'use strict';

/**
 * Organization (tenant) data access. `db` is either the pool or a transaction client.
 */

async function create(db, { name }) {
  const { rows } = await db.query(
    'INSERT INTO organizations (name) VALUES ($1) RETURNING id, name, created_at, updated_at',
    [name],
  );
  return rows[0];
}

async function findById(db, organizationId) {
  const { rows } = await db.query(
    'SELECT id, name, created_at, updated_at FROM organizations WHERE id = $1',
    [organizationId],
  );
  return rows[0] || null;
}

module.exports = { create, findById };
