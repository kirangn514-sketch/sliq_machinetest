import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/** Renders the current location so tests can assert navigation. */
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

/**
 * Renders `ui` at `route`, matched by `path` (for useParams), inside a MemoryRouter.
 * Extra routes can be supplied to observe redirects.
 */
export function renderWithRouter(ui, { route = '/', path = '*', extraRoutes = null } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={<>{ui}<LocationProbe /></>} />
        {extraRoutes}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

export const makeUser = (overrides = {}) => ({
  id: 10,
  name: 'Alice Admin',
  email: 'alice@example.com',
  role: 'admin',
  organization: { id: 1, name: 'Acme' },
  ...overrides,
});

export const makeTicket = (overrides = {}) => ({
  id: 100,
  title: 'VPN down',
  description: 'Users cannot connect',
  status: 'open',
  priority: 'high',
  overdue: false,
  slaDueAt: '2026-01-01T10:05:00.000Z',
  version: 3,
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:00:00.000Z',
  creator: { id: 10, name: 'Alice Admin' },
  assignee: null,
  sla: { state: 'on_track', dueAt: '2026-01-01T10:05:00.000Z' },
  ...overrides,
});
