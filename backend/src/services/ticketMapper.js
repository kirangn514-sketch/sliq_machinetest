'use strict';

/**
 * Maps database rows to API DTOs. Raw rows are never returned to clients.
 */
const slaService = require('./slaService');

function toTicketDto(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    overdue: row.overdue,
    slaDueAt: row.sla_due_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator: { id: row.created_by, name: row.creator_name, email: row.creator_email },
    assignee: row.assignee_id
      ? {
        id: row.assignee_id, name: row.assignee_name, email: row.assignee_email, active: row.assignee_active,
      }
      : null,
    sla: slaService.describe(row),
  };
}

function toListItemDto(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    overdue: row.overdue,
    slaDueAt: row.sla_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator: { id: row.created_by, name: row.creator_name },
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null,
  };
}

function toCommentDto(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    message: row.message,
    isStaffResponse: row.is_staff_response,
    createdAt: row.created_at,
    author: { id: row.user_id, name: row.author_name, role: row.author_role },
  };
}

module.exports = { toTicketDto, toListItemDto, toCommentDto };
