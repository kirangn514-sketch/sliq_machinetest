'use strict';

const express = require('express');
const controller = require('../controllers/authController');
const { authenticate, optionalAuthenticate } = require('../middlewares/authMiddleware');
const { tenantContext } = require('../middlewares/tenantMiddleware');
const { authLimiter } = require('../middlewares/rateLimitMiddleware');

const router = express.Router();
const tenantIfAuthenticated = (req, res, next) => (req.user ? tenantContext(req, res, next) : next());

// Public
router.get('/csrf', controller.csrf);
router.post('/signup', authLimiter, controller.signup);
router.post('/login', authLimiter, controller.login);
router.post('/invitations/preview', authLimiter, controller.previewInvitation);
router.post('/invitations/accept', authLimiter, controller.acceptInvitation);

// Session
router.post('/logout', optionalAuthenticate, tenantIfAuthenticated, controller.logout);
router.get('/me', authenticate, tenantContext, controller.me);

module.exports = router;
