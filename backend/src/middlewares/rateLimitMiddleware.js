'use strict';

const { rateLimit } = require('express-rate-limit');
const env = require('../config/env');
const { failure } = require('../utils/response');

/** Limits brute-force attempts on login / signup / invitation acceptance. */
const authLimiter = rateLimit({
  windowMs: env.authRateLimit.windowMs,
  limit: env.authRateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => failure(res, {
    statusCode: 429,
    message: 'Too many attempts. Please try again later.',
    errorCode: 'RATE_LIMITED',
  }),
});

module.exports = { authLimiter };
