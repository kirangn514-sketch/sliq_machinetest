'use strict';

const settingsService = require('../services/settingsService');
const { success } = require('../utils/response');

async function getSla(req, res) {
  return success(res, { data: { sla: await settingsService.getSla(req.ctx) } });
}

async function updateSla(req, res) {
  const sla = await settingsService.updateSla(req.ctx, req.body);
  return success(res, { message: 'SLA settings updated', data: { sla } });
}

module.exports = { getSla, updateSla };
