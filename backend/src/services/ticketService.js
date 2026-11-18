'use strict';

/**
 * Ticket business rules: creation, listing, detail, updates, permissions and transitions.
 *
 * Permission rules (enforced here, not only in routes):
 *  - admin  : may update any ticket in their organization
 *  - agent  : may update tickets assigned to them OR unassigned tickets
 *  - viewer : read-only
 * A closed ticket is immutable. All checks run against the row locked FOR UPDATE.
 */
const { pool, withTransaction } = require('../config/database');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validation');
const { ROLES, STAFF_ROLES } = require('../constants/roles');
const { ALL_STATUSES, TICKET_STATUS, canTransition } = require('../constants/ticketStatus');
const { ALL_PRIORITIES, isSlaPriority } = require('../constants/ticketPriority');
const { EVENTS } = require('../constants/events');
const ticketRepository = require('../repositories/ticketRepository');
const userRepository = require('../repositories/userRepository');
const commentRepository = require('../repositories/commentRepository');
const slaService = require('./slaService');
const notificationService = require('./notificationService');
const audit = require('./auditService');
const realtime = require('./realtimeService');
const { toTicketDto, toListItemDto, toCommentDto } = require('./ticketMapper');

/** The assignee must be an ACTIVE admin/agent of the SAME organization. */
async function assertAssignable(db, organizationId, assigneeId) {
  const user = await userRepository.findById(db, organizationId, assigneeId);
  if (!user || !user.is_active || !STAFF_ROLES.includes(user.role)) {
    throw AppError.badRequest('Validation failed', {
      fields: { assigneeId: 'Assignee must be an active admin or agent in your organization' },
    });
  }
}

function assertCanModify(ctx, ticket) {
  if (ctx.role === ROLES.ADMIN) return;
  if (ctx.role === ROLES.AGENT && (ticket.assignee_id === null || ticket.assignee_id === ctx.userId)) return;
  throw AppError.forbidden('You can only update tickets assigned to you or unassigned tickets');
}

async function createTicket(ctx, input) {
  const data = validate(input)
    .string('title', { min: 1, max: 200 })
    .string('description', { min: 1, max: 10000 })
    .oneOf('priority', ALL_PRIORITIES, { required: false })
    .integer('assigneeId', { required: false, nullable: true })
    .result();

  const { detail, notification } = await withTransaction(async (client) => {
    if (data.assigneeId) await assertAssignable(client, ctx.organizationId, data.assigneeId);

    const ticket = await ticketRepository.create(client, {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description,
      priority: data.priority || 'medium',
      assigneeId: data.assigneeId || null,
      createdBy: ctx.userId,
    });
    if (isSlaPriority(ticket.priority)) await slaService.startCycle(client, ctx.organizationId, ticket.id);

    let note = null;
    if (ticket.assignee_id && ticket.assignee_id !== ctx.userId) {
      note = await notificationService.createAssignmentNotification(client, ticket, ticket.assignee_id, ctx.name);
    }
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.TICKET_CREATED, entityType: 'ticket', entityId: ticket.id,
      newValue: {
        title: ticket.title, priority: ticket.priority, status: ticket.status, assigneeId: ticket.assignee_id,
      },
    });
    return {
      detail: await ticketRepository.findDetailById(client, ctx.organizationId, ticket.id),
      notification: note,
    };
  });

  const dto = toTicketDto(detail);
  const events = [realtime.toOrg(ctx.organizationId, EVENTS.TICKET_CREATED, dto)];
  if (notification) events.push(realtime.toUser(detail.assignee_id, EVENTS.NOTIFICATION_CREATED, notification));
  realtime.emit(events);
  return dto;
}

function parseListQuery(query) {
  const q = validate(query)
    .integer('page', { required: false, min: 1, max: 100000 })
    .integer('limit', { required: false, min: 1, max: 100 })
    .oneOf('status', ALL_STATUSES, { required: false })
    .oneOf('priority', ALL_PRIORITIES, { required: false })
    .oneOf('overdue', ['true', 'false'], { required: false })
    .string('search', { required: false, max: 100 });

  const rawAssignee = query.assigneeId;
  if (rawAssignee !== undefined && rawAssignee !== '' && rawAssignee !== 'unassigned') q.integer('assigneeId');
  const out = q.result();
  if (rawAssignee === 'unassigned') out.assigneeId = 'unassigned';
  return out;
}

async function listTickets(ctx, query) {
  const q = parseListQuery(query || {});
  const page = q.page || 1;
  const limit = q.limit || 10;
  const filters = {
    status: q.status,
    priority: q.priority,
    assigneeId: q.assigneeId,
    overdue: q.overdue === undefined ? undefined : q.overdue === 'true',
    search: q.search,
  };
  const { rows, total } = await ticketRepository.list(pool, ctx.organizationId, filters, {
    limit, offset: (page - 1) * limit,
  });
  return {
    items: rows.map(toListItemDto),
    pagination: {
      page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getTicket(ctx, ticketId) {
  const detail = await ticketRepository.findDetailById(pool, ctx.organizationId, ticketId);
  if (!detail) throw AppError.notFound('Ticket not found');
  const comments = await commentRepository.listByTicket(pool, ctx.organizationId, ticketId);
  return { ...toTicketDto(detail), comments: comments.map(toCommentDto) };
}

async function getStats(ctx) {
  return ticketRepository.stats(pool, ctx.organizationId);
}

function parseUpdate(input) {
  const data = validate(input)
    .string('title', { required: false, min: 1, max: 200 })
    .string('description', { required: false, min: 1, max: 10000 })
    .oneOf('status', ALL_STATUSES, { required: false })
    .oneOf('priority', ALL_PRIORITIES, { required: false })
    .integer('assigneeId', { required: false, nullable: true })
    .integer('version', { required: false })
    .result();
  const { version, ...fields } = data;
  if (Object.keys(fields).length === 0) {
    throw AppError.badRequest('Provide at least one field to update: title, description, status, priority, assigneeId');
  }
  return { fields, version };
}

/** Computes the column-level diff; validates transition + assignee. */
async function buildChanges(client, ctx, locked, fields) {
  const changes = {};
  if (fields.title !== undefined && fields.title !== locked.title) changes.title = fields.title;
  if (fields.description !== undefined && fields.description !== locked.description) {
    changes.description = fields.description;
  }
  if (fields.priority !== undefined && fields.priority !== locked.priority) changes.priority = fields.priority;
  if (fields.status !== undefined && fields.status !== locked.status) {
    if (!canTransition(locked.status, fields.status)) {
      throw new AppError(400, `Invalid status transition: ${locked.status} -> ${fields.status}`, 'INVALID_STATUS_TRANSITION');
    }
    changes.status = fields.status;
  }
  if (fields.assigneeId !== undefined && fields.assigneeId !== locked.assignee_id) {
    if (fields.assigneeId !== null) await assertAssignable(client, ctx.organizationId, fields.assigneeId);
    changes.assignee_id = fields.assigneeId;
  }
  return changes;
}

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

async function updateTicket(ctx, ticketId, input) {
  const { fields, version } = parseUpdate(input);

  const result = await withTransaction(async (client) => {
    const locked = await ticketRepository.findByIdForUpdate(client, ctx.organizationId, ticketId);
    if (!locked) throw AppError.notFound('Ticket not found');
    assertCanModify(ctx, locked);
    if (locked.status === TICKET_STATUS.CLOSED) throw AppError.conflict('Closed tickets cannot be modified', 'TICKET_CLOSED');
    if (version !== undefined && version !== locked.version) {
      throw AppError.conflict('The ticket was modified by someone else. Reload and try again.', 'STALE_TICKET');
    }

    const changes = await buildChanges(client, ctx, locked, fields);
    if (Object.keys(changes).length === 0) {
      return { detail: await ticketRepository.findDetailById(client, ctx.organizationId, ticketId), changed: false };
    }

    const updated = await ticketRepository.update(client, ctx.organizationId, ticketId, changes);
    await slaService.reconcileAfterUpdate(client, locked, updated);

    let note = null;
    if (changes.assignee_id && changes.assignee_id !== ctx.userId) {
      note = await notificationService.createAssignmentNotification(client, updated, changes.assignee_id, ctx.name);
    }
    await audit.record(client, ctx, {
      eventType: audit.AUDIT.TICKET_UPDATED, entityType: 'ticket', entityId: ticketId,
      oldValue: pick(locked, Object.keys(changes)), newValue: changes,
    });
    return {
      detail: await ticketRepository.findDetailById(client, ctx.organizationId, ticketId), changed: true, note,
    };
  });

  const dto = toTicketDto(result.detail);
  if (result.changed) {
    const events = [realtime.toOrg(ctx.organizationId, EVENTS.TICKET_UPDATED, dto)];
    if (result.note) events.push(realtime.toUser(dto.assignee.id, EVENTS.NOTIFICATION_CREATED, result.note));
    realtime.emit(events);
  }
  return dto;
}

module.exports = {
  createTicket, listTickets, getTicket, getStats, updateTicket, assertAssignable,
};
