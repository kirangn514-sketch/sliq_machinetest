'use strict';

const commentService = require('../services/commentService');
const { success } = require('../utils/response');
const { parseId } = require('../utils/validation');

async function list(req, res) {
  const comments = await commentService.listComments(req.ctx, parseId(req.params.id));
  return success(res, { data: { comments } });
}

async function create(req, res) {
  const comment = await commentService.addComment(req.ctx, parseId(req.params.id), req.body);
  return success(res, { statusCode: 201, message: 'Comment added', data: { comment } });
}

module.exports = { list, create };
