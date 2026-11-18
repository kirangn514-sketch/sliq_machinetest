'use strict';

const express = require('express');
const { pool } = require('../config/database');
const { success, failure } = require('../utils/response');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return success(res, { message: 'OK', data: { status: 'ok', database: 'up' } });
  } catch (err) {
    return failure(res, { statusCode: 503, message: 'Database unavailable', errorCode: 'DB_UNAVAILABLE' });
  }
});

router.use('/auth', require('./authRoutes'));
router.use('/members', require('./memberRoutes'));
router.use('/tickets', require('./ticketRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/settings', require('./settingsRoutes'));

module.exports = router;
