'use strict';

const memberService = require('../services/memberService');
const memberManagementService = require('../services/memberManagementService');
const { success } = require('../utils/response');
const { parseId } = require('../utils/validation');

async function list(req, res) {
  return success(res, { data: await memberService.listMembers(req.ctx) });
}

async function directory(req, res) {
  return success(res, { data: { members: await memberService.directory(req.ctx) } });
}

async function invite(req, res) {
  const data = await memberManagementService.inviteMember(req.ctx, req.body);
  return success(res, { statusCode: 201, message: 'Invitation created', data });
}

async function changeRole(req, res) {
  const data = await memberManagementService.changeRole(req.ctx, parseId(req.params.id), req.body);
  return success(res, { message: 'Role updated', data });
}

async function remove(req, res) {
  const data = await memberManagementService.removeMember(req.ctx, parseId(req.params.id));
  return success(res, { message: 'Member removed', data });
}

async function revokeInvitation(req, res) {
  const data = await memberManagementService.revokeInvitation(req.ctx, parseId(req.params.id));
  return success(res, { message: 'Invitation revoked', data });
}

module.exports = {
  list, directory, invite, changeRole, remove, revokeInvitation,
};
