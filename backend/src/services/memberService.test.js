'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/userRepository');
jest.mock('../repositories/invitationRepository');
jest.mock('../utils/password');
jest.mock('./realtimeService', () => ({
  emit: jest.fn(),
  toOrg: (organizationId, event, payload) => ({ room: `organization:${organizationId}`, event, payload }),
}));
jest.mock('./authService', () => ({
  toPublicUser: jest.fn((u) => ({ id: u.id, organization: { id: u.organization_id, name: u.organization_name } })),
  issueToken: jest.fn(() => 'jwt'),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));

const { pool, client } = require('../config/database');
const userRepository = require('../repositories/userRepository');
const invitationRepository = require('../repositories/invitationRepository');
const { hashPassword } = require('../utils/password');
const realtime = require('./realtimeService');
const audit = require('./auditService');
const memberService = require('./memberService');
const { ctx, userRow } = require('../testUtils/factories');

const TOKEN = 'x'.repeat(43);
const invitation = (overrides) => ({
  id: 5, organization_id: 1, name: 'Bob', email: 'bob@example.com', role: 'agent', organization_name: 'Org A', ...overrides,
});

describe('hashInvitationToken', () => {
  it('is a deterministic SHA-256 hex digest (raw token never stored)', () => {
    const h = memberService.hashInvitationToken(TOKEN);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(memberService.hashInvitationToken(TOKEN));
    expect(h).not.toContain(TOKEN);
  });
});

describe('listMembers / directory', () => {
  it('lists members and pending invitations of the caller organization only', async () => {
    // Arrange
    userRepository.listActive.mockResolvedValue([userRow()]);
    invitationRepository.listPending.mockResolvedValue([{
      id: 1, name: 'Bob', email: 'b@x.io', role: 'agent', expires_at: 'e', created_at: 'c',
    }]);
    // Act
    const result = await memberService.listMembers(ctx({ organizationId: 9 }));
    // Assert
    expect(userRepository.listActive).toHaveBeenCalledWith(pool, 9);
    expect(invitationRepository.listPending).toHaveBeenCalledWith(pool, 9);
    expect(result.members[0]).toEqual(expect.objectContaining({ id: 10, email: 'alice@example.com' }));
    expect(result.members[0]).not.toHaveProperty('password_hash');
    expect(result.invitations[0]).toEqual({
      id: 1, name: 'Bob', email: 'b@x.io', role: 'agent', expiresAt: 'e', createdAt: 'c',
    });
  });

  it('directory exposes only id, name and role', async () => {
    userRepository.listActive.mockResolvedValue([userRow()]);
    expect(await memberService.directory(ctx())).toEqual([{ id: 10, name: 'Alice', role: 'admin' }]);
  });
});

describe('previewInvitation', () => {
  it('looks up by token hash and returns a safe summary', async () => {
    invitationRepository.findValidByTokenHash.mockResolvedValue(invitation({ expires_at: 'soon' }));
    const result = await memberService.previewInvitation({ token: TOKEN });
    expect(invitationRepository.findValidByTokenHash).toHaveBeenCalledWith(pool, memberService.hashInvitationToken(TOKEN));
    expect(result).toEqual({
      name: 'Bob', email: 'bob@example.com', role: 'agent', organizationName: 'Org A', expiresAt: 'soon',
    });
  });

  it('returns 404 for unknown, used or expired tokens', async () => {
    invitationRepository.findValidByTokenHash.mockResolvedValue(null);
    await expect(memberService.previewInvitation({ token: TOKEN })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates token shape', async () => {
    await expect(memberService.previewInvitation({ token: 'short' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('acceptInvitation', () => {
  beforeEach(() => {
    hashPassword.mockResolvedValue('hash');
    invitationRepository.findValidByTokenHash.mockResolvedValue(invitation());
  });

  it('creates the member in the INVITATION organization and logs them in', async () => {
    // Arrange
    userRepository.findByEmail.mockResolvedValue(null);
    userRepository.create.mockResolvedValue(userRow({ id: 20, email: 'bob@example.com', role: 'agent' }));
    // Act
    const result = await memberService.acceptInvitation({ token: TOKEN, password: 'Password123', organizationId: 99 }, { ip: 'ip' });
    // Assert
    expect(invitationRepository.findValidByTokenHash).toHaveBeenCalledWith(client, expect.any(String), { forUpdate: true });
    expect(userRepository.create).toHaveBeenCalledWith(client, {
      organizationId: 1, name: 'Bob', passwordHash: 'hash', role: 'agent', email: 'bob@example.com',
    });
    expect(invitationRepository.markAccepted).toHaveBeenCalledWith(client, 1, 5);
    expect(audit.record).toHaveBeenCalledWith(client, expect.objectContaining({ organizationId: 1, userId: 20 }), expect.objectContaining({ eventType: 'INVITATION_ACCEPTED' }));
    expect(realtime.emit).toHaveBeenCalledWith([expect.objectContaining({ room: 'organization:1', event: 'members:changed' })]);
    expect(result).toEqual({ user: expect.objectContaining({ id: 20 }), token: 'jwt' });
  });

  it('reactivates a previously removed member with the same email', async () => {
    userRepository.findByEmail.mockResolvedValue(userRow({ id: 30, is_active: false }));
    userRepository.reactivate.mockResolvedValue(userRow({ id: 30 }));
    await memberService.acceptInvitation({ token: TOKEN, password: 'Password123', name: 'Robert' }, {});
    expect(userRepository.reactivate).toHaveBeenCalledWith(client, expect.objectContaining({ userId: 30, name: 'Robert', role: 'agent' }));
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('rejects with 409 if an active member already uses the email', async () => {
    userRepository.findByEmail.mockResolvedValue(userRow({ is_active: true }));
    await expect(memberService.acceptInvitation({ token: TOKEN, password: 'Password123' }, {}))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'EMAIL_EXISTS' });
    expect(invitationRepository.markAccepted).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens with 404 and weak passwords with 400', async () => {
    invitationRepository.findValidByTokenHash.mockResolvedValue(null);
    await expect(memberService.acceptInvitation({ token: TOKEN, password: 'Password123' }, {}))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(memberService.acceptInvitation({ token: TOKEN, password: 'weak' }, {}))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
