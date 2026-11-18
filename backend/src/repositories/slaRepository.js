'use strict';

/**
 * SLA settings data access (one row per organization).
 */

async function createDefault(db, organizationId, minutes) {
  const { rows } = await db.query(
    `INSERT INTO sla_settings (organization_id, response_time_minutes)
     VALUES ($1, $2)
     ON CONFLICT (organization_id) DO NOTHING
     RETURNING organization_id, response_time_minutes, updated_at`,
    [organizationId, minutes],
  );
  return rows[0] || null;
}

async function findByOrganization(db, organizationId) {
  const { rows } = await db.query(
    `SELECT organization_id, response_time_minutes, updated_at
       FROM sla_settings WHERE organization_id = $1`,
    [organizationId],
  );
  return rows[0] || null;
}

async function findByOrganizationForUpdate(db, organizationId) {
  const { rows } = await db.query(
    `SELECT organization_id, response_time_minutes, updated_at
       FROM sla_settings WHERE organization_id = $1 FOR UPDATE`,
    [organizationId],
  );
  return rows[0] || null;
}

/** Upsert so organizations created before the settings row existed still work. */
async function upsert(db, organizationId, minutes) {
  const { rows } = await db.query(
    `INSERT INTO sla_settings (organization_id, response_time_minutes)
     VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET response_time_minutes = EXCLUDED.response_time_minutes
     RETURNING organization_id, response_time_minutes, updated_at`,
    [organizationId, minutes],
  );
  return rows[0];
}

module.exports = {
  createDefault, findByOrganization, findByOrganizationForUpdate, upsert,
};
