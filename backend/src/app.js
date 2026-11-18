'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const apiRouter = require('./routes');
const { csrfProtection } = require('./middlewares/csrfMiddleware');
const { errorHandler, notFoundHandler } = require('./middlewares/errorMiddleware');

const app = express();

// Behind Nginx: trust the first proxy hop so req.ip / rate limiting use the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin.replace(/\/$/, ''))),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', csrfProtection);

// Versioned API; /api/* is kept as an alias of the current version (v1).
app.use('/api/v1', apiRouter);
app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
