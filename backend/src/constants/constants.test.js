'use strict';

const { canTransition, STATUS_TRANSITIONS, ALL_STATUSES } = require('./ticketStatus');
const { isSlaPriority, ALL_PRIORITIES } = require('./ticketPriority');
const { ALL_ROLES, STAFF_ROLES } = require('./roles');
const { orgRoom, userRoom } = require('./events');

describe('ticket status transitions', () => {
  it.each([
    ['open', 'in_progress'], ['open', 'resolved'],
    ['in_progress', 'open'], ['in_progress', 'resolved'],
    ['resolved', 'open'], ['resolved', 'closed'],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['open', 'closed'], ['in_progress', 'closed'], ['resolved', 'in_progress'],
    ['closed', 'open'], ['closed', 'resolved'], ['bogus', 'open'],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('makes closed terminal and covers every status', () => {
    expect(STATUS_TRANSITIONS.closed).toEqual([]);
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe('priorities and roles', () => {
  it('monitors only high and urgent tickets', () => {
    expect(ALL_PRIORITIES.filter(isSlaPriority)).toEqual(['high', 'urgent']);
  });

  it('defines exactly three roles, staff = admin + agent', () => {
    expect(ALL_ROLES).toEqual(['admin', 'agent', 'viewer']);
    expect(STAFF_ROLES).toEqual(['admin', 'agent']);
  });

  it('builds room names', () => {
    expect(orgRoom(3)).toBe('organization:3');
    expect(userRoom(7)).toBe('user:7');
  });
});
