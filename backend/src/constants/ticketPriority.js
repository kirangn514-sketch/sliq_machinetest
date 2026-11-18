'use strict';

const TICKET_PRIORITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
});

const ALL_PRIORITIES = Object.freeze(Object.values(TICKET_PRIORITY));

/** Only these priorities are monitored by the SLA worker. */
const SLA_PRIORITIES = Object.freeze(['high', 'urgent']);

function isSlaPriority(priority) {
  return SLA_PRIORITIES.includes(priority);
}

module.exports = {
  TICKET_PRIORITY, ALL_PRIORITIES, SLA_PRIORITIES, isSlaPriority,
};
