'use strict';

const { validate, parseId } = require('./validation');
const AppError = require('./AppError');

function errorsOf(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected validation to throw');
}

describe('validation.string', () => {
  it('trims and returns valid strings', () => {
    // Arrange
    const input = { name: '  Alice  ' };
    // Act
    const out = validate(input).string('name', { max: 10 }).result();
    // Assert
    expect(out).toEqual({ name: 'Alice' });
  });

  it('keeps whitespace when trim is disabled', () => {
    const out = validate({ p: ' x ' }).string('p', { trim: false }).result();
    expect(out.p).toBe(' x ');
  });

  it.each([
    [{}, 'name is required'],
    [{ name: null }, 'name is required'],
    [{ name: '' }, 'name is required'],
    [{ name: 42 }, 'name must be a string'],
    [{ name: '   ' }, 'name must be at least 1 characters'],
    [{ name: 'abcdef' }, 'name must be at most 5 characters'],
  ])('rejects %j', (input, message) => {
    const err = errorsOf(() => validate(input).string('name', { max: 5 }).result());
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.details.fields.name).toBe(message);
  });

  it('skips optional missing values', () => {
    expect(validate({}).string('name', { required: false }).result()).toEqual({});
  });
});

describe('validation.email', () => {
  it('lowercases valid emails', () => {
    expect(validate({ email: ' John@Example.COM ' }).email('email').result()).toEqual({ email: 'john@example.com' });
  });

  it('rejects malformed emails', () => {
    const err = errorsOf(() => validate({ email: 'not-an-email' }).email('email').result());
    expect(err.details.fields.email).toMatch(/valid email/);
  });

  it('allows a missing optional email', () => {
    expect(validate({}).email('email', { required: false }).result()).toEqual({});
  });
});

describe('validation.password', () => {
  it('accepts a strong password without trimming', () => {
    expect(validate({ password: 'Password123' }).password('password').result()).toEqual({ password: 'Password123' });
  });

  it.each([
    [undefined, 'password is required'],
    [123, 'password is required'],
    ['Ab1', 'password must be at least 8 characters'],
    [`${'a'.repeat(72)}1`, 'password must be at most 72 bytes'],
    ['onlyletters', 'password must contain at least one letter and one number'],
    ['12345678', 'password must contain at least one letter and one number'],
  ])('rejects %p', (password, message) => {
    const err = errorsOf(() => validate({ password }).password('password').result());
    expect(err.details.fields.password).toBe(message);
  });
});

describe('validation.oneOf', () => {
  it('accepts allowed values', () => {
    expect(validate({ role: 'agent' }).oneOf('role', ['admin', 'agent']).result()).toEqual({ role: 'agent' });
  });

  it('rejects values outside the whitelist', () => {
    const err = errorsOf(() => validate({ role: 'root' }).oneOf('role', ['admin', 'agent']).result());
    expect(err.details.fields.role).toBe('role must be one of: admin, agent');
  });

  it('requires a value unless optional', () => {
    expect(errorsOf(() => validate({}).oneOf('role', ['a']).result()).details.fields.role).toBe('role is required');
    expect(validate({ role: '' }).oneOf('role', ['a'], { required: false }).result()).toEqual({});
  });
});

describe('validation.integer', () => {
  it('parses numeric strings and numbers', () => {
    expect(validate({ a: '7', b: 3 }).integer('a').integer('b').result()).toEqual({ a: 7, b: 3 });
  });

  it('supports nullable values', () => {
    expect(validate({ a: null }).integer('a', { nullable: true }).result()).toEqual({ a: null });
  });

  it.each([['abc'], [1.5], [0], ['999999']])('rejects %p outside the range', (value) => {
    const err = errorsOf(() => validate({ a: value }).integer('a', { min: 1, max: 1000 }).result());
    expect(err.details.fields.a).toBe('a must be an integer between 1 and 1000');
  });

  it('handles missing values', () => {
    expect(errorsOf(() => validate({}).integer('a').result()).details.fields.a).toBe('a is required');
    expect(validate({ a: null }).integer('a', { required: false }).result()).toEqual({});
  });
});

describe('validation errors', () => {
  it('keeps only the first error per field', () => {
    const v = validate({});
    v.addError('x', 'first');
    v.addError('x', 'second');
    expect(v.errors).toEqual({ x: 'first' });
  });

  it('treats a missing input object as empty', () => {
    expect(validate(undefined).string('a', { required: false }).result()).toEqual({});
  });
});

describe('parseId', () => {
  it('returns positive integers', () => {
    expect(parseId('42')).toBe(42);
  });

  it.each(['abc', '0', '-1', '1.5', '2147483648', undefined])('turns %p into a 404 (no id oracle)', (raw) => {
    const err = errorsOf(() => parseId(raw));
    expect(err.statusCode).toBe(404);
  });
});
