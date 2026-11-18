'use strict';

/**
 * Organization settings (SLA response time). Changes apply to SLA cycles started
 * after the update; already-pending jobs keep the deadline they were armed with.
 */
const { pool, withTransaction } = require('../config/database');
const env = require('../config/env');
const { validate } = require('../utils/validation');
const slaRepository = require('../repositories/slaRepository');
const audit = require('./auditService');

const toDto = (row) => ({
  responseTimeMinutes: row ? row.response_time_minutes : env.sla.defaultMinutes,
  updatedAt: row ? row.updated_at : null,
  monitoredPriorities: ['high', 'urgent'],
});

async function getSla(ctx) {
  return toDto(await slaRepository.findByOrganization(pool, ctx.organizationId));
}

async function updateSla(ctx, input) {
  const { responseTimeMinutes } = validate(input)
    .integer('responseTimeMinutes', { min: 1, max: 43200 })
    .result();

  const row = await withTransaction(async (client) => {
    const before = await slaRepository.findByOrganizationForUpdate(client, ctx.organizationId);
    const updated = await slaRepository.upsert(client, ctx.organizationId, responseTimeMinutes);
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.SLA_SETTINGS_UPDATED, entityType: 'sla_settings', entityId: ctx.organizationId,
      oldValue: { responseTimeMinutes: before ? before.response_time_minutes : null },
      newValue: { responseTimeMinutes },
    });
    return updated;
  });
  return toDto(row);
}

module.exports = { getSla, updateSla };
