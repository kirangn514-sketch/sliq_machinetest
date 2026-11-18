'use strict';

/**
 * Comments. Lock order inside the transaction is ALWAYS ticket -> sla_job (same as
 * ticket updates), and the SLA worker never waits on a ticket lock (SKIP LOCKED),
 * so there is no deadlock between comments, updates and the worker.
 */
const { pool, withTransaction } = require('../config/database');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const { STAFF_ROLES } = require('../constants/roles');
const { TICKET_STATUS } = require('../constants/ticketStatus');
const { EVENTS } = require('../constants/events');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const jobRepository = require('../repositories/jobRepository');
const slaService = require('./slaService');
const audit = require('./auditService');
const realtime = require('./realtimeService');
const { toCommentDto, toTicketDto } = require('./ticketMapper');

async function listComments(ctx, ticketId) {
  const ticket = await ticketRepository.findDetailById(pool, ctx.organizationId, ticketId);
  if (!ticket) throw AppError.notFound('Ticket not found');
  const rows = await commentRepository.listByTicket(pool, ctx.organizationId, ticketId);
  return rows.map(toCommentDto);
}

async function addComment(ctx, ticketId, input) {
  const { message } = validate(input).string('message', { min: 1, max: 5000 }).result();
  const isStaff = STAFF_ROLES.includes(ctx.role);

  const result = await withTransaction(async (client) => {
    const ticket = await ticketRepository.findByIdForUpdate(client, ctx.organizationId, ticketId);
    if (!ticket) throw AppError.notFound('Ticket not found');
    if (ticket.status === TICKET_STATUS.CLOSED) {
      throw AppError.conflict('Closed tickets cannot receive comments', 'TICKET_CLOSED');
    }

    // Lock the SLA job BEFORE inserting so the worker cannot decide the deadline concurrently.
    const job = isStaff ? await jobRepository.findByTicketForUpdate(client, ctx.organizationId, ticketId) : null;
    const comment = await commentRepository.create(client, {
      organizationId: ctx.organizationId, ticketId, userId: ctx.userId, message, isStaffResponse: isStaff,
    });
    const slaMet = await slaService.registerStaffResponse(client, job, comment.created_at);
    await ticketRepository.touch(client, ctx.organizationId, ticketId);

    await audit.record(client, ctx, {
      eventType: audit.AUDIT.COMMENT_CREATED, entityType: 'comment', entityId: comment.id,
      newValue: { ticketId, length: message.length, slaMet },
    });
    const detail = await ticketRepository.findDetailById(client, ctx.organizationId, ticketId);
    return { comment, detail };
  });

  const commentDto = toCommentDto(result.comment);
  realtime.emit([
    realtime.toOrg(ctx.organizationId, EVENTS.COMMENT_CREATED, { ticketId, comment: commentDto }),
    realtime.toOrg(ctx.organizationId, EVENTS.TICKET_UPDATED, toTicketDto(result.detail)),
  ]);
  return commentDto;
}

module.exports = { listComments, addComment };
