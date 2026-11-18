'use strict';

const express = require('express');
const controller = require('../controllers/ticketController');
const commentRoutes = require('./commentRoutes');
const { authenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');
const { authorizeRoles } = require('../middlewares/roleMiddleware');

const router = express.Router();
router.use(authenticate, tenantContext);

router.get('/', controller.list);
router.get('/stats', controller.stats);
router.post('/', authorizeRoles('admin', 'agent'), controller.create);
router.get('/:id', controller.getById);
// Ownership rules (agent: own/unassigned only) are enforced in ticketService.
router.put('/:id', authorizeRoles('admin', 'agent'), controller.update);

router.use('/:id/comments', commentRoutes);

module.exports = router;
