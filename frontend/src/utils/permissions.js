/**
 * Centralised UI permission rules. These only decide what to SHOW - the backend
 * enforces every rule independently and is the source of truth.
 */
export const ROLES = Object.freeze({ ADMIN: 'admin', AGENT: 'agent', VIEWER: 'viewer' });

export const STATUS_TRANSITIONS = Object.freeze({
  open: ['in_progress', 'resolved'],
  in_progress: ['open', 'resolved'],
  resolved: ['open', 'closed'],
  closed: [],
});

const isStaff = (user) => !!user && (user.role === ROLES.ADMIN || user.role === ROLES.AGENT);
const isAdmin = (user) => !!user && user.role === ROLES.ADMIN;

export const can = {
  viewTickets: (user) => !!user,
  createTicket: isStaff,
  comment: (user, ticket) => isStaff(user) && (!ticket || ticket.status !== 'closed'),
  manageMembers: isAdmin,
  manageSettings: isAdmin,
  /** admin: any ticket; agent: assigned to self or unassigned; never closed tickets. */
  updateTicket: (user, ticket) => {
    if (!user || !ticket || ticket.status === 'closed') return false;
    if (isAdmin(user)) return true;
    if (user.role === ROLES.AGENT) return !ticket.assignee || ticket.assignee.id === user.id;
    return false;
  },
};

export const allowedNextStatuses = (status) => STATUS_TRANSITIONS[status] || [];

export default can;
