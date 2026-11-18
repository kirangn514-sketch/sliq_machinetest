'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/organizationRepository');
jest.mock('../repositories/userRepository');
jest.mock('../repositories/slaRepository');
jest.mock('../utils/password');
jest.mock('../utils/jwt');
jest.mock('./auditService', () => ({
  AUDIT: jest.requireActual('./auditService').AUDIT,
  record: jest.fn(),
}));

const { pool, client } = require('../config/database');
const organizationRepository = require('../repositories/organizationRepository');
const userRepository = require('../repositories/userRepository');
const slaRepository = require('../repositories/slaRepository');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken, verifyToken } = require('../utils/jwt');
const audit = require('./auditService');
const authService = require('./authService');
const { userRow } = require('../testUtils/factories');

const SIGNUP = {
  organizationName: 'ABC Technologies', name: 'John', email: 'John@Example.com', password: 'Password123',
};

describe('authService.signup', () => {
  beforeEach(() => {
    hashPassword.mockResolvedValue('$2b$hash');
    organizationRepository.create.mockResolvedValue({ id: 7, name: 'ABC Technologies' });
    userRepository.create.mockResolvedValue(userRow({
      id: 70, organization_id: 7, name: 'John', email: 'john@example.com', role: 'admin',
    }));
    signToken.mockReturnValue('jwt');
  });

  it('creates org + admin + default SLA + audit in one transaction', async () => {
    // Act
    const result = await authService.signup(SIGNUP, { ip: '1.2.3.4' });
    // Assert
    expect(organizationRepository.create).toHaveBeenCalledWith(client, { name: 'ABC Technologies' });
    expect(userRepository.create).toHaveBeenCalledWith(client, {
      organizationId: 7, name: 'John', email: 'john@example.com', passwordHash: '$2b$hash', role: 'admin',
    });
    expect(slaRepository.createDefault).toHaveBeenCalledWith(client, 7, 5);
    expect(audit.record).toHaveBeenCalledWith(client, { organizationId: 7, userId: 70, ip: '1.2.3.4' }, expect.objectContaining({ eventType: 'ORGANIZATION_SIGNUP' }));
    expect(result).toEqual({
      user: {
        id: 70, name: 'John', email: 'john@example.com', role: 'admin', organization: { id: 7, name: 'ABC Technologies' },
      },
      token: 'jwt',
    });
    expect(signToken).toHaveBeenCalledWith({ userId: 70, organizationId: 7, tokenVersion: 0 });
  });

  it('never stores or audits the plain password', async () => {
    await authService.signup(SIGNUP, { ip: null });
    expect(JSON.stringify(userRepository.create.mock.calls)).not.toContain('Password123');
    expect(JSON.stringify(audit.record.mock.calls)).not.toMatch(/Password123|\$2b\$hash/);
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(authService.signup({ ...SIGNUP, password: 'short', email: 'x' }, {}))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(organizationRepository.create).not.toHaveBeenCalled();
  });
});

describe('authService.login', () => {
  const candidate = (overrides) => ({ ...userRow(), password_hash: 'h', ...overrides });

  beforeEach(() => { signToken.mockReturnValue('jwt'); });

  it('logs in when exactly one account matches', async () => {
    // Arrange
    userRepository.findActiveCredentialsByEmail.mockResolvedValue([candidate()]);
    verifyPassword.mockResolvedValue(true);
    // Act
    const result = await authService.login({ email: 'ALICE@example.com', password: 'Password123' }, { ip: 'ip' });
    // Assert
    expect(userRepository.findActiveCredentialsByEmail).toHaveBeenCalledWith(pool, 'alice@example.com');
    expect(result.user).toEqual(expect.objectContaining({ id: 10, organization: { id: 1, name: 'Org A' } }));
    expect(result.user).not.toHaveProperty('password_hash');
    expect(audit.record).toHaveBeenCalledWith(pool, expect.objectContaining({ userId: 10 }), expect.objectContaining({ eventType: 'LOGIN_SUCCESS' }));
  });

  it('returns 401 and audits when the password is wrong', async () => {
    userRepository.findActiveCredentialsByEmail.mockResolvedValue([candidate()]);
    verifyPassword.mockResolvedValue(false);
    await expect(authService.login({ email: 'alice@example.com', password: 'Wrong1234' }, { ip: 'ip' }))
      .rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
    expect(audit.record).toHaveBeenCalledWith(pool, { ip: 'ip' }, expect.objectContaining({ eventType: 'LOGIN_FAILED' }));
  });

  it('still runs bcrypt for unknown emails (timing) and returns the same 401', async () => {
    userRepository.findActiveCredentialsByEmail.mockResolvedValue([]);
    verifyPassword.mockResolvedValue(false);
    await expect(authService.login({ email: 'nobody@example.com', password: 'x' }, {}))
      .rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
    expect(verifyPassword).toHaveBeenCalledWith('x', null);
  });

  it('asks to choose when the credentials unlock several organizations (only matching ones listed)', async () => {
    // Arrange
    userRepository.findActiveCredentialsByEmail.mockResolvedValue([
      candidate({ id: 1, organization_id: 1, organization_name: 'A' }),
      candidate({ id: 2, organization_id: 2, organization_name: 'B' }),
      candidate({ id: 3, organization_id: 3, organization_name: 'C' }),
    ]);
    verifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    // Act + Assert
    await expect(authService.login({ email: 'a@example.com', password: 'p' }, {})).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'ORGANIZATION_SELECTION_REQUIRED',
      details: { organizations: [{ id: 1, name: 'A' }, { id: 3, name: 'C' }] },
    });
  });

  it('uses organizationId only to pick among accounts the password unlocked', async () => {
    userRepository.findActiveCredentialsByEmail.mockResolvedValue([
      candidate({ id: 1, organization_id: 1 }), candidate({ id: 2, organization_id: 2 }),
    ]);
    verifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    // org 2 exists but the password does not unlock it -> 401
    await expect(authService.login({ email: 'a@example.com', password: 'p', organizationId: 2 }, {}))
      .rejects.toMatchObject({ statusCode: 401 });

    verifyPassword.mockResolvedValue(true);
    const ok = await authService.login({ email: 'a@example.com', password: 'p', organizationId: 2 }, {});
    expect(ok.user.id).toBe(2);
  });

  it('validates input', async () => {
    await expect(authService.login({ email: 'bad' }, {})).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('authService.resolveSession', () => {
  it('returns the live user when token and DB state agree', async () => {
    // Arrange
    verifyToken.mockReturnValue({ userId: 10, organizationId: 1, tokenVersion: 2 });
    userRepository.findAuthContext.mockResolvedValue(userRow({ token_version: 2 }));
    // Act
    const { user, claims } = await authService.resolveSession('tok');
    // Assert
    expect(userRepository.findAuthContext).toHaveBeenCalledWith(pool, 1, 10);
    expect(user.id).toBe(10);
    expect(claims.tokenVersion).toBe(2);
  });

  it('rejects invalid/expired tokens with 401', async () => {
    verifyToken.mockImplementation(() => { throw new Error('jwt expired'); });
    await expect(authService.resolveSession('tok')).rejects.toMatchObject({ statusCode: 401, message: 'Session expired or invalid' });
  });

  it.each([
    ['user no longer exists', null],
    ['user was removed', userRow({ is_active: false })],
    ['token was revoked (version bumped)', userRow({ token_version: 3 })],
  ])('rejects when %s', async (_label, dbUser) => {
    verifyToken.mockReturnValue({ userId: 10, organizationId: 1, tokenVersion: 2 });
    userRepository.findAuthContext.mockResolvedValue(dbUser);
    await expect(authService.resolveSession('tok')).rejects.toMatchObject({ statusCode: 401, message: 'Session is no longer valid' });
  });
});

describe('authService helpers', () => {
  it('toPublicUser prefers an explicit organization name', () => {
    expect(authService.toPublicUser(userRow(), 'Explicit').organization.name).toBe('Explicit');
  });

  it('recordLogout writes a LOGOUT audit row', async () => {
    const c = { organizationId: 1, userId: 10, ip: 'ip' };
    await authService.recordLogout(c);
    expect(audit.record).toHaveBeenCalledWith(pool, c, { eventType: 'LOGOUT', entityType: 'user', entityId: 10 });
  });
});
