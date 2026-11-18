'use strict';

const TICKET_STATUS = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

const ALL_STATUSES = Object.freeze(Object.values(TICKET_STATUS));

/** Allowed transitions. A closed ticket is immutable. */
const STATUS_TRANSITIONS = Object.freeze({
  open: Object.freeze(['in_progress', 'resolved']),
  in_progress: Object.freeze(['open', 'resolved']),
  resolved: Object.freeze(['open', 'closed']),
  closed: Object.freeze([]),
});

/** Statuses in which the SLA clock can run. */
const ACTIVE_STATUSES = Object.freeze(['open', 'in_progress']);

function canTransition(from, to) {
  return (STATUS_TRANSITIONS[from] || []).includes(to);
}

module.exports = {
  TICKET_STATUS, ALL_STATUSES, STATUS_TRANSITIONS, ACTIVE_STATUSES, canTransition,
};
