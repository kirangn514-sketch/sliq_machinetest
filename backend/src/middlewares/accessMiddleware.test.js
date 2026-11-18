'use strict';

const { authorizeRoles } = require('./roleMiddleware');
const { tenantContext } = require('./tenantMiddleware');
const { httpDoubles } = require('../testUtils/factories');

describe('authorizeRoles', () => {
  it.each([
    ['admin', ['admin', 'agent'], true],
    ['agent', ['admin', 'agent'], true],
    ['viewer', ['admin', 'agent'], false],
    ['agent', ['admin'], false],
  ])('role %s with allowed %j -> allowed=%s', (role, allowed, ok) => {
    // Arrange
    const { req, res, next } = httpDoubles({ user: { role } });
    // Act
    authorizeRoles(...allowed)(req, res, next);
    // Assert
    if (ok) expect(next).toHaveBeenCalledWith();
    else expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('returns 401 when no user is attached', () => {
    const { req, res, next } = httpDoubles();
    authorizeRoles('admin')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('fails fast on typos in role names at startup', () => {
    expect(() => authorizeRoles('superuser')).toThrow('Unknown role in authorizeRoles: superuser');
  });
});

describe('tenantContext', () => {
  const user = {
    id: 10, organizationId: 1, role: 'agent', name: 'Al',
  };

  it('derives organizationId from the authenticated identity and freezes ctx', () => {
    // Arrange
    const { req, res, next } = httpDoubles({ user });
    // Act
    tenantContext(req, res, next);
    // Assert
    expect(req.ctx).toEqual({
      organizationId: 1, userId: 10, role: 'agent', name: 'Al', ip: '127.0.0.1',
    });
    expect(Object.isFrozen(req.ctx)).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('strips any organization id supplied by the client', () => {
    const { req, res, next } = httpDoubles({
      user, body: { title: 't', organizationId: 2, organization_id: 3, orgId: 4 },
    });
    tenantContext(req, res, next);
    expect(req.body).toEqual({ title: 't' });
    expect(req.ctx.organizationId).toBe(1);
  });

  it('tolerates requests without a body', () => {
    const { req, res, next } = httpDoubles({ user });
    req.body = undefined;
    tenantContext(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it.each([[undefined], [{ id: 1, organizationId: 'x' }]])('rejects a missing/invalid identity %j', (u) => {
    const { req, res, next } = httpDoubles({ user: u });
    tenantContext(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.ctx).toBeUndefined();
  });
});
