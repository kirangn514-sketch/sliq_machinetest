jest.mock('../api/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
  },
}));

const { default: api } = require('../api/api');
const { authService } = require('./authService');
const { ticketService } = require('./ticketService');
const { commentService } = require('./commentService');
const { memberService } = require('./memberService');
const { notificationService } = require('./notificationService');
const { settingsService } = require('./settingsService');

const envelope = (data) => Promise.resolve({ success: true, data });

describe('authService', () => {
  it('calls the auth endpoints and unwraps users', async () => {
    api.get.mockReturnValue(envelope({ user: { id: 1 } }));
    api.post.mockReturnValue(envelope({ user: { id: 2 }, email: 'x' }));
    expect(await authService.me()).toEqual({ id: 1 });
    expect(await authService.login({ email: 'a', password: 'b', organizationId: 3 })).toEqual({ id: 2 });
    expect(api.post).toHaveBeenLastCalledWith('/auth/login', { email: 'a', password: 'b', organizationId: 3 });
    expect(await authService.signup({ name: 'n' })).toEqual({ id: 2 });
    await authService.logout();
    expect(api.post).toHaveBeenLastCalledWith('/auth/logout');
    expect(await authService.previewInvitation('t')).toEqual({ user: { id: 2 }, email: 'x' });
    expect(await authService.acceptInvitation({ token: 't', password: 'p' })).toEqual({ id: 2 });
    expect(api.post).toHaveBeenLastCalledWith('/auth/invitations/accept', { token: 't', password: 'p', name: undefined });
  });
});

describe('ticketService', () => {
  it('drops empty filters from list params', async () => {
    api.get.mockReturnValue(envelope({ items: [], pagination: {} }));
    await ticketService.list({
      status: 'open', priority: '', assigneeId: null, overdue: undefined, page: 2,
    });
    expect(api.get).toHaveBeenCalledWith('/tickets', { params: { status: 'open', page: 2 } });
    await ticketService.list();
    expect(api.get).toHaveBeenLastCalledWith('/tickets', { params: {} });
  });

  it('maps CRUD calls', async () => {
    api.get.mockReturnValueOnce(envelope({ stats: { total: 1 } })).mockReturnValueOnce(envelope({ ticket: { id: 5 } }));
    api.post.mockReturnValue(envelope({ ticket: { id: 6 } }));
    api.put.mockReturnValue(envelope({ ticket: { id: 5, title: 'x' } }));
    expect(await ticketService.stats()).toEqual({ total: 1 });
    expect(await ticketService.get(5)).toEqual({ id: 5 });
    expect(await ticketService.create({ title: 't' })).toEqual({ id: 6 });
    expect(await ticketService.update(5, { title: 'x' })).toEqual({ id: 5, title: 'x' });
    expect(api.put).toHaveBeenCalledWith('/tickets/5', { title: 'x' });
  });
});

describe('commentService', () => {
  it('lists and creates comments', async () => {
    api.get.mockReturnValue(envelope({ comments: [{ id: 1 }] }));
    api.post.mockReturnValue(envelope({ comment: { id: 2 } }));
    expect(await commentService.list(5)).toEqual([{ id: 1 }]);
    expect(await commentService.create(5, 'hi')).toEqual({ id: 2 });
    expect(api.post).toHaveBeenCalledWith('/tickets/5/comments', { message: 'hi' });
  });
});

describe('memberService', () => {
  it('maps member management endpoints', async () => {
    api.get.mockReturnValueOnce(envelope({ members: [], invitations: [] })).mockReturnValueOnce(envelope({ members: [{ id: 1 }] }));
    api.post.mockReturnValue(envelope({ invitation: {} }));
    api.put.mockReturnValue(envelope({ member: {} }));
    api.delete.mockReturnValue(envelope({ id: 2 }));
    expect(await memberService.list()).toEqual({ members: [], invitations: [] });
    expect(await memberService.directory()).toEqual([{ id: 1 }]);
    expect(await memberService.invite({ email: 'e' })).toEqual({ invitation: {} });
    expect(await memberService.changeRole(2, 'viewer')).toEqual({ member: {} });
    expect(api.put).toHaveBeenCalledWith('/members/2/role', { role: 'viewer' });
    await memberService.remove(2);
    expect(api.delete).toHaveBeenLastCalledWith('/members/2');
    await memberService.revokeInvitation(3);
    expect(api.delete).toHaveBeenLastCalledWith('/members/invitations/3');
  });
});

describe('notificationService / settingsService', () => {
  it('maps notification endpoints', async () => {
    api.get.mockReturnValue(envelope({ items: [], unreadCount: 0 }));
    api.patch.mockReturnValue(envelope({ updated: 1 }));
    await notificationService.list();
    expect(api.get).toHaveBeenCalledWith('/notifications', { params: { page: 1, limit: 10 } });
    await notificationService.markRead(4);
    expect(api.patch).toHaveBeenLastCalledWith('/notifications/4/read');
    expect(await notificationService.markAllRead()).toEqual({ updated: 1 });
  });

  it('maps SLA settings endpoints', async () => {
    api.get.mockReturnValue(envelope({ sla: { responseTimeMinutes: 5 } }));
    api.put.mockReturnValue(envelope({ sla: { responseTimeMinutes: 9 } }));
    expect(await settingsService.getSla()).toEqual({ responseTimeMinutes: 5 });
    expect(await settingsService.updateSla(9)).toEqual({ responseTimeMinutes: 9 });
    expect(api.put).toHaveBeenCalledWith('/settings/sla', { responseTimeMinutes: 9 });
  });
});
