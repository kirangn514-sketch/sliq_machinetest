'use strict';

const notificationService = require('../services/notificationService');
const { success } = require('../utils/response');
const { parseId } = require('../utils/validation');

async function list(req, res) {
  return success(res, { data: await notificationService.list(req.ctx, req.query) });
}

async function markRead(req, res) {
  const data = await notificationService.markRead(req.ctx, parseId(req.params.id));
  return success(res, { message: 'Notification marked as read', data });
}

async function markAllRead(req, res) {
  const data = await notificationService.markAllRead(req.ctx);
  return success(res, { message: 'All notifications marked as read', data });
}

module.exports = { list, markRead, markAllRead };
