'use strict';

const ticketService = require('../services/ticketService');
const { success } = require('../utils/response');
const { parseId } = require('../utils/validation');

async function create(req, res) {
  const ticket = await ticketService.createTicket(req.ctx, req.body);
  return success(res, { statusCode: 201, message: 'Ticket created', data: { ticket } });
}

async function list(req, res) {
  return success(res, { data: await ticketService.listTickets(req.ctx, req.query) });
}

async function stats(req, res) {
  return success(res, { data: { stats: await ticketService.getStats(req.ctx) } });
}

async function getById(req, res) {
  const ticket = await ticketService.getTicket(req.ctx, parseId(req.params.id));
  return success(res, { data: { ticket } });
}

async function update(req, res) {
  const ticket = await ticketService.updateTicket(req.ctx, parseId(req.params.id), req.body);
  return success(res, { message: 'Ticket updated', data: { ticket } });
}

module.exports = {
  create, list, stats, getById, update,
};
