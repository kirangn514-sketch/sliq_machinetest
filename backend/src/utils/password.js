'use strict';

const bcrypt = require('bcrypt');
const env = require('../config/env');

// Pre-computed hash used to equalise response timing when an account does not exist.
const DUMMY_HASH = bcrypt.hashSync('sliqdesk-timing-equaliser', env.bcryptRounds);

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash || DUMMY_HASH);
}

module.exports = { hashPassword, verifyPassword };
