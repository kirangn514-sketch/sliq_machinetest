'use strict';

/** Socket.IO event names shared by the API and the worker. */
const EVENTS = Object.freeze({
  TICKET_CREATED: 'ticket:created',
  TICKET_UPDATED: 'ticket:updated',
  COMMENT_CREATED: 'comment:created',
  TICKET_OVERDUE: 'ticket:overdue',
  NOTIFICATION_CREATED: 'notification:created',
  MEMBERS_CHANGED: 'members:changed',
});

const orgRoom = (organizationId) => `organization:${organizationId}`;
const userRoom = (userId) => `user:${userId}`;

module.exports = { EVENTS, orgRoom, userRoom };
