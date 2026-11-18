'use strict';

jest.mock('../config/database', () => {
  const client = { query: jest.fn() };
  return { pool: { query: jest.fn() }, withTransaction: jest.fn((work) => work(client)), client };
});
jest.mock('../repositories/userRepository');
jest.mock('../repositories/invitationRepository');
jest.mock('../repositories/ticketRepository');
jest.mock('./realtimeService', () => ({
  emit: jest.fn(),
  disconnectUser: jest.fn(),
  toOrg: (organizationId, event, payload) => ({ room: `organization:${organizationId}`, event, payload }),
}));
jest.mock('./auditService', () => ({ AUDIT: jest.requireActual('./auditService').AUDIT, record: jest.fn() }));

const { client } = require('../config/database');
const userRepository = require('../repositories/userRepository');
const invitationRepository = require('../repositories/invitationRepository');
const ticketRepository = require('../repositories/ticketRepository');
const realtime = require('./realtimeService');
const audit = require('./auditService');
const { withEnv, ctx, userRow } = require('../testUtils/factories');

const service = require('./memberManagementService');

const admin = ctx({ organizationId: 1, userId: 10, role: 'admin' });

describe('inviteMember', () => {
  beforeEach(() => {
    userRepository.findByEmail.mockResolvedValue(null);
    invitationRepository.create.mockImplementation(async (_db, data) => ({
      id: 3, name: data.name, email: data.email, role: data.role, expires_at: data.expiresAt, created_at: 'now',
    }));
  });

  it('stores only the token hash and returns a fragment-based invite URL in development', async () => {
    // Act
    const result = await service.inviteMember(admin, { name: 'Bob', email: 'BOB@example.com', role: 'agent' });
    // Assert
    const stored = invitationRepository.create.mock.calls[0][1];
    const rawToken = result.invitationUrl.split('#token=')[1];
    expect(result.invitationUrl).toMatch(/^http:\/\/localhost:3000\/accept-invite#token=/);
    expect(rawToken).toHaveLength(43); // 32 random bytes, base64url
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored).toEqual(expect.objectContaining({ organizationId: 1, email: 'bob@example.com', invitedBy: 10 }));
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 71 * 3600 * 1000);
    expect(invitationRepository.revokeOpenByEmail).toHaveBeenCalledWith(client, 1, 'bob@example.com');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(rawToken);
  });

  it('does not return the invitation URL in production', async () => {
    // Arrange: fresh module graph with NODE_ENV=production (mocks are re-created in the sandbox)
    let prodService;
    withEnv({ NODE_ENV: 'production' }, () => {
      jest.isolateModules(() => {
        require('../repositories/userRepository').findByEmail.mockResolvedValue(null);
        require('../repositories/invitationRepository').create.mockResolvedValue({ id: 3, email: 'bob@example.com' });
        prodService = require('./memberManagementService');
      });
    });
    // Act
    const result = await prodService.inviteMember(admin, { name: 'Bob', email: 'bob@example.com', role: 'viewer' });
    // Assert
    expect(result).not.toHaveProperty('invitationUrl');
  });

  it('rejects duplicate active emails within the organization', async () => {
    userRepository.findByEmail.mockResolvedValue(userRow({ is_active: true }));
    await expect(service.inviteMember(admin, { name: 'Bob', email: 'alice@example.com', role: 'agent' }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'EMAIL_EXISTS' });
    expect(invitationRepository.create).not.toHaveBeenCalled();
  });

  it('allows re-inviting a removed member', async () => {
    userRepository.findByEmail.mockResolvedValue(userRow({ is_active: false }));
    await expect(service.inviteMember(admin, { name: 'A', email: 'alice@example.com', role: 'agent' })).resolves.toBeDefined();
  });

  it('validates role and email', async () => {
    await expect(service.inviteMember(admin, { name: 'X', email: 'nope', role: 'root' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('revokeInvitation', () => {
  it('revokes within the organization and audits', async () => {
    invitationRepository.revoke.mockResolvedValue({ id: 3, email: 'b@x.io', role: 'agent' });
    const result = await service.revokeInvitation(admin, 3);
    expect(invitationRepository.revoke).toHaveBeenCalledWith(client, 1, 3);
    expect(result.id).toBe(3);
    expect(audit.record).toHaveBeenCalledWith(client, admin, expect.objectContaining({ eventType: 'INVITATION_REVOKED' }));
  });

  it('returns 404 for unknown / foreign invitations', async () => {
    invitationRepository.revoke.mockResolvedValue(null);
    await expect(service.revokeInvitation(admin, 3)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('changeRole', () => {
  beforeEach(() => {
    userRepository.lockActiveAdmins.mockResolvedValue([10, 11]);
    userRepository.updateRole.mockImplementation(async (_db, _org, id, role) => userRow({ id, role }));
    ticketRepository.unassignAllForUser.mockResolvedValue([]);
  });

  it('locks admins first, then updates the role and audits old/new values', async () => {
    // Arrange
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 20, role: 'agent' }));
    // Act
    const result = await service.changeRole(admin, 20, { role: 'admin' });
    // Assert
    expect(userRepository.lockActiveAdmins).toHaveBeenCalledWith(client, 1);
    expect(userRepository.findByIdForUpdate).toHaveBeenCalledWith(client, 1, 20);
    expect(result).toEqual({ member: expect.objectContaining({ id: 20, role: 'admin' }), unassignedTicketIds: [] });
    expect(audit.record).toHaveBeenCalledWith(client, admin, expect.objectContaining({
      eventType: 'MEMBER_ROLE_CHANGED', oldValue: { role: 'agent' },
    }));
    expect(realtime.emit).toHaveBeenCalledWith([expect.objectContaining({ event: 'members:changed' })]);
  });

  it('is a no-op when the role is unchanged', async () => {
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 20, role: 'agent' }));
    await service.changeRole(admin, 20, { role: 'agent' });
    expect(userRepository.updateRole).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to demote the last admin', async () => {
    userRepository.lockActiveAdmins.mockResolvedValue([10]);
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 10, role: 'admin' }));
    await expect(service.changeRole(admin, 10, { role: 'agent' }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: 'LAST_ADMIN' });
    expect(userRepository.updateRole).not.toHaveBeenCalled();
  });

  it('allows demoting an admin when another admin remains', async () => {
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 11, role: 'admin' }));
    await expect(service.changeRole(admin, 11, { role: 'agent' })).resolves.toBeDefined();
  });

  it('unassigns tickets when a member is demoted to viewer', async () => {
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 20, role: 'agent' }));
    ticketRepository.unassignAllForUser.mockResolvedValue([100, 101]);
    const result = await service.changeRole(admin, 20, { role: 'viewer' });
    expect(result.unassignedTicketIds).toEqual([100, 101]);
    expect(realtime.emit.mock.calls[0][0]).toHaveLength(3);
  });

  it.each([[null], [userRow({ id: 20, is_active: false })]])('returns 404 for missing/foreign/inactive members (%#)', async (target) => {
    userRepository.findByIdForUpdate.mockResolvedValue(target);
    await expect(service.changeRole(admin, 20, { role: 'agent' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates the role', async () => {
    await expect(service.changeRole(admin, 20, { role: 'owner' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('removeMember', () => {
  beforeEach(() => {
    userRepository.lockActiveAdmins.mockResolvedValue([10, 11]);
    ticketRepository.unassignAllForUser.mockResolvedValue([100]);
  });

  it('soft-deletes, unassigns tickets, audits, disconnects sockets and notifies', async () => {
    // Arrange
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 20, role: 'agent', email: 'bob@x.io' }));
    // Act
    const result = await service.removeMember(admin, 20);
    // Assert
    expect(userRepository.deactivate).toHaveBeenCalledWith(client, 1, 20);
    expect(ticketRepository.unassignAllForUser).toHaveBeenCalledWith(client, 1, 20);
    expect(audit.record).toHaveBeenCalledWith(client, admin, expect.objectContaining({ eventType: 'MEMBER_REMOVED', entityId: 20 }));
    expect(realtime.disconnectUser).toHaveBeenCalledWith(20);
    expect(realtime.emit).toHaveBeenCalledWith([
      expect.objectContaining({ event: 'members:changed' }),
      expect.objectContaining({ event: 'ticket:updated', payload: { id: 100 } }),
    ]);
    expect(result).toEqual({ id: 20, unassignedTicketIds: [100] });
  });

  it('refuses to remove the last admin', async () => {
    userRepository.lockActiveAdmins.mockResolvedValue([10]);
    userRepository.findByIdForUpdate.mockResolvedValue(userRow({ id: 10, role: 'admin' }));
    await expect(service.removeMember(admin, 10)).rejects.toMatchObject({ errorCode: 'LAST_ADMIN' });
    expect(userRepository.deactivate).not.toHaveBeenCalled();
    expect(realtime.disconnectUser).not.toHaveBeenCalled();
  });

  it('returns 404 for members of another organization', async () => {
    userRepository.findByIdForUpdate.mockResolvedValue(null);
    await expect(service.removeMember(admin, 999)).rejects.toMatchObject({ statusCode: 404 });
  });
});
