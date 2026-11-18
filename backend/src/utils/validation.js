'use strict';

/**
 * Tiny dependency-free validator. Collects field errors and throws a single
 * 400 AppError with `error: { fields: { name: message } }`.
 */
const AppError = require('./AppError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class Validator {
  constructor(input) {
    this.input = input || {};
    this.errors = {};
    this.output = {};
  }

  addError(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
  }

  string(field, { required = true, min = 1, max = 255, trim = true } = {}) {
    let value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (required) this.addError(field, `${field} is required`);
      return this;
    }
    if (typeof value !== 'string') {
      this.addError(field, `${field} must be a string`);
      return this;
    }
    if (trim) value = value.trim();
    if (value.length < min) this.addError(field, `${field} must be at least ${min} characters`);
    else if (value.length > max) this.addError(field, `${field} must be at most ${max} characters`);
    else this.output[field] = value;
    return this;
  }

  email(field, { required = true } = {}) {
    this.string(field, { required, max: 150 });
    if (this.output[field] !== undefined) {
      const value = this.output[field].toLowerCase();
      if (!EMAIL_RE.test(value)) {
        this.addError(field, `${field} must be a valid email address`);
        delete this.output[field];
      } else {
        this.output[field] = value;
      }
    }
    return this;
  }

  password(field) {
    const value = this.input[field];
    if (typeof value !== 'string' || value.length === 0) {
      this.addError(field, `${field} is required`);
    } else if (value.length < 8) {
      this.addError(field, `${field} must be at least 8 characters`);
    } else if (Buffer.byteLength(value, 'utf8') > 72) {
      this.addError(field, `${field} must be at most 72 bytes`);
    } else if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
      this.addError(field, `${field} must contain at least one letter and one number`);
    } else {
      this.output[field] = value;
    }
    return this;
  }

  oneOf(field, allowed, { required = true } = {}) {
    const value = this.input[field];
    if (value === undefined || value === null || value === '') {
      if (required) this.addError(field, `${field} is required`);
      return this;
    }
    if (!allowed.includes(value)) this.addError(field, `${field} must be one of: ${allowed.join(', ')}`);
    else this.output[field] = value;
    return this;
  }

  integer(field, { required = true, min = 1, max = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
    const raw = this.input[field];
    if (raw === null && nullable) {
      this.output[field] = null;
      return this;
    }
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.addError(field, `${field} is required`);
      return this;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.addError(field, `${field} must be an integer between ${min} and ${max}`);
    } else {
      this.output[field] = value;
    }
    return this;
  }

  /** Throws a 400 if any rule failed; otherwise returns the sanitised values. */
  result() {
    if (Object.keys(this.errors).length > 0) {
      throw AppError.badRequest('Validation failed', { fields: this.errors });
    }
    return this.output;
  }
}

const validate = (input) => new Validator(input);

/** Parses a route/query id; anything that is not a positive integer becomes 404 (no oracle). */
function parseId(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw AppError.notFound();
  }
  return value;
}

module.exports = { validate, parseId };
