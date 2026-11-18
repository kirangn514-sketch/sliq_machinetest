'use strict';

const express = require('express');
const controller = require('../controllers/commentController');
const { authorizeRoles } = require('../middlewares/roleMiddleware');

// Mounted under /tickets/:id/comments (authentication + tenant context applied by the parent router).
const router = express.Router({ mergeParams: true });

router.get('/', controller.list);
router.post('/', authorizeRoles('admin', 'agent'), controller.create);

module.exports = router;
