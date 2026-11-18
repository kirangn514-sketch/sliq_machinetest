import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute, { GuestRoute } from './ProtectedRoute';
import { useAuth } from '../context/AuthContext';
import { LocationProbe, makeUser } from '../testUtils/renderWithRouter';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));

/** Only the route under test is guarded; the redirect target lives outside the guard (as in App.jsx). */
function renderAt(route, element) {
  const guardedPath = route;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={element}>
          <Route path={guardedPath} element={<p>{guardedPath === '/login' ? 'login page' : 'secret page'}</p>} />
        </Route>
        {guardedPath !== '/login' && <Route path="/login" element={<p>login page</p>} />}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loader while the session is being checked', () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    renderAt('/secret', <ProtectedRoute />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  });

  it('redirects anonymous users to /login', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/secret', <ProtectedRoute />);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the page for authenticated users', () => {
    useAuth.mockReturnValue({ user: makeUser({ role: 'viewer' }), loading: false });
    renderAt('/secret', <ProtectedRoute />);
    expect(screen.getByText('secret page')).toBeInTheDocument();
  });

  it.each([
    ['viewer', ['admin'], false],
    ['agent', ['admin'], false],
    ['agent', ['admin', 'agent'], true],
    ['admin', ['admin'], true],
  ])('role %s with roles=%j -> allowed=%s', (role, roles, allowed) => {
    useAuth.mockReturnValue({ user: makeUser({ role }), loading: false });
    renderAt('/secret', <ProtectedRoute roles={roles} />);
    if (allowed) {
      expect(screen.getByText('secret page')).toBeInTheDocument();
    } else {
      expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
      expect(screen.getByText(new RegExp(`Your role \\(${role}\\)`))).toBeInTheDocument();
      expect(screen.queryByText('secret page')).not.toBeInTheDocument();
    }
  });
});

describe('GuestRoute', () => {
  it('shows a loader while loading', () => {
    useAuth.mockReturnValue({ user: null, loading: true });
    renderAt('/login', <GuestRoute />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the guest page for anonymous users', () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderAt('/login', <GuestRoute />);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('bounces logged-in users to the dashboard', () => {
    useAuth.mockReturnValue({ user: makeUser(), loading: false });
    renderAt('/login', <GuestRoute />);
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});
