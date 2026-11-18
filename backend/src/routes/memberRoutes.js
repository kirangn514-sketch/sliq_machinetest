'use strict';

const express = require('express');
const controller = require('../controllers/memberController');
const { authenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');
const { authorizeRoles } = require('../middlewares/roleMiddleware');

const router = express.Router();
router.use(authenticate, tenantContext);

// Any member: names for assignee pickers / filters
router.get('/directory', controller.directory);

// Admin only: member management
router.get('/', authorizeRoles('admin'), controller.list);
router.post('/', authorizeRoles('admin'), controller.invite);
router.put('/:id/role', authorizeRoles('admin'), controller.changeRole);
router.delete('/invitations/:id', authorizeRoles('admin'), controller.revokeInvitation);
router.delete('/:id', authorizeRoles('admin'), controller.remove);

module.exports = router;
