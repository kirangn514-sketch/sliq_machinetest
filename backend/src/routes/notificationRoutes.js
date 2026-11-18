'use strict';

const express = require('express');
const controller = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');

const router = express.Router();
router.use(authenticate, tenantContext);

router.get('/', controller.list);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

module.exports = router;
