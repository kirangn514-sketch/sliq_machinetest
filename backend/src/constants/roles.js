'use strict';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  AGENT: 'agent',
  VIEWER: 'viewer',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

/** Roles whose comments count as a qualifying SLA response and who may work tickets. */
const STAFF_ROLES = Object.freeze([ROLES.ADMIN, ROLES.AGENT]);

module.exports = { ROLES, ALL_ROLES, STAFF_ROLES };
