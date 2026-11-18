import {
  can, allowedNextStatuses, STATUS_TRANSITIONS, ROLES,
} from './permissions';
import {
  formatDate, relativeTime, STATUS_LABELS, PRIORITY_LABELS, ROLE_LABELS,
} from './format';

const admin = { id: 1, role: 'admin' };
const agent = { id: 2, role: 'agent' };
const viewer = { id: 3, role: 'viewer' };

describe('permissions (UI mirror of backend rules)', () => {
  it.each([
    ['createTicket', [true, true, false]],
    ['manageMembers', [true, false, false]],
    ['manageSettings', [true, false, false]],
    ['viewTickets', [true, true, true]],
  ])('%s for admin/agent/viewer', (rule, expected) => {
    expect([admin, agent, viewer].map((u) => can[rule](u))).toEqual(expected);
  });

  it('denies everything to anonymous users', () => {
    expect(can.viewTickets(null)).toBe(false);
    expect(can.createTicket(null)).toBe(false);
    expect(can.manageMembers(undefined)).toBe(false);
    expect(can.comment(null)).toBe(false);
    expect(can.updateTicket(null, { status: 'open' })).toBe(false);
  });

  it('lets staff comment except on closed tickets', () => {
    expect(can.comment(agent)).toBe(true);
    expect(can.comment(agent, { status: 'open' })).toBe(true);
    expect(can.comment(admin, { status: 'closed' })).toBe(false);
    expect(can.comment(viewer, { status: 'open' })).toBe(false);
  });

  it.each([
    [admin, { status: 'open', assignee: { id: 99 } }, true],
    [agent, { status: 'open', assignee: null }, true],
    [agent, { status: 'open', assignee: { id: 2 } }, true],
    [agent, { status: 'open', assignee: { id: 99 } }, false],
    [viewer, { status: 'open', assignee: null }, false],
    [admin, { status: 'closed', assignee: null }, false],
    [admin, null, false],
    [{ id: 4, role: 'unknown' }, { status: 'open', assignee: null }, false],
  ])('updateTicket(%j, %j) -> %s', (user, ticket, expected) => {
    expect(can.updateTicket(user, ticket)).toBe(expected);
  });

  it('mirrors the backend transition table', () => {
    expect(allowedNextStatuses('open')).toEqual(['in_progress', 'resolved']);
    expect(allowedNextStatuses('resolved')).toEqual(['open', 'closed']);
    expect(allowedNextStatuses('closed')).toEqual([]);
    expect(allowedNextStatuses('nope')).toEqual([]);
    expect(Object.keys(STATUS_TRANSITIONS)).toEqual(['open', 'in_progress', 'resolved', 'closed']);
    expect(ROLES.ADMIN).toBe('admin');
  });
});

describe('format', () => {
  it('formats dates and placeholders', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('2026-01-01T10:00:00.000Z')).toMatch(/2026/);
  });

  it.each([
    [30 * 1000, /second/],
    [-5 * 60 * 1000, /minute/],
    [3 * 3600 * 1000, /hour/],
    [-3 * 86400 * 1000, /day|yesterday|ago/],
  ])('relativeTime picks a sensible unit for %p ms', (offset, pattern) => {
    expect(relativeTime(new Date(Date.now() + offset).toISOString())).toMatch(pattern);
  });

  it('relativeTime handles empty values', () => {
    expect(relativeTime(null)).toBe('');
  });

  it('has labels for every enum value', () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(4);
    expect(Object.keys(PRIORITY_LABELS)).toHaveLength(4);
    expect(Object.keys(ROLE_LABELS)).toEqual(['admin', 'agent', 'viewer']);
  });
});
