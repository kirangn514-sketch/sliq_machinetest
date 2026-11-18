'use strict';

const express = require('express');
const controller = require('../controllers/settingsController');
const { authenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');
const { authorizeRoles } = require('../middlewares/roleMiddleware');

const router = express.Router();
router.use(authenticate, tenantContext);

// Everyone may read the SLA policy (shown in ticket details); only admins change it.
router.get('/sla', controller.getSla);
router.put('/sla', authorizeRoles('admin'), controller.updateSla);

module.exports = router;
