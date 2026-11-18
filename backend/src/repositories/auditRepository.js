'use strict';

/**
 * Append-only audit trail. Callers must never pass passwords, hashes or tokens.
 */
async function insert(db, {
  organizationId = null,
  eventType,
  entityType,
  entityId = null,
  performedBy = null,
  oldValue = null,
  newValue = null,
  ipAddress = null,
}) {
  await db.query(
    `INSERT INTO audit_logs
       (organization_id, event_type, entity_type, entity_id, performed_by, old_value, new_value, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      organizationId,
      eventType,
      entityType,
      entityId,
      performedBy,
      oldValue === null ? null : JSON.stringify(oldValue),
      newValue === null ? null : JSON.stringify(newValue),
      ipAddress,
    ],
  );
}

module.exports = { insert };
