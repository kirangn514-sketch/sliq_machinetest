import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useAuth } from './context/AuthContext';
import { makeUser } from './testUtils/renderWithRouter';

jest.mock('./context/AuthContext', () => ({ useAuth: jest.fn() }));
// Pages are replaced by markers: this test is about routing and guards only.
jest.mock('./components/layout/Layout', () => {
  const { Outlet } = jest.requireActual('react-router-dom');
  return { __esModule: true, default: () => <div data-testid="layout"><Outlet /></div> };
});
// jest.mock must be literal top-level calls to be hoisted above the imports.
jest.mock('./pages/Login', () => ({ __esModule: true, default: () => <p>page:Login</p> }));
jest.mock('./pages/Signup', () => ({ __esModule: true, default: () => <p>page:Signup</p> }));
jest.mock('./pages/AcceptInvite', () => ({ __esModule: true, default: () => <p>page:AcceptInvite</p> }));
jest.mock('./pages/Dashboard', () => ({ __esModule: true, default: () => <p>page:Dashboard</p> }));
jest.mock('./pages/TicketList', () => ({ __esModule: true, default: () => <p>page:TicketList</p> }));
jest.mock('./pages/TicketDetails', () => ({ __esModule: true, default: () => <p>page:TicketDetails</p> }));
jest.mock('./pages/CreateTicket', () => ({ __esModule: true, default: () => <p>page:CreateTicket</p> }));
jest.mock('./pages/Members', () => ({ __esModule: true, default: () => <p>page:Members</p> }));
jest.mock('./pages/Settings', () => ({ __esModule: true, default: () => <p>page:Settings</p> }));

function renderApp(route, user) {
  useAuth.mockReturnValue({ user, loading: false });
  return render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>);
}

describe('App routing', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/tickets', 'TicketList'],
    ['/tickets/42', 'TicketDetails'],
    ['/tickets/new', 'CreateTicket'],
    ['/members', 'Members'],
    ['/settings', 'Settings'],
  ])('admin can open %s', (route, page) => {
    renderApp(route, makeUser({ role: 'admin' }));
    expect(screen.getByText(`page:${page}`)).toBeInTheDocument();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it.each([
    ['viewer', '/tickets/new'], ['viewer', '/members'], ['agent', '/members'], ['agent', '/settings'],
  ])('%s is denied %s', (role, route) => {
    renderApp(route, makeUser({ role }));
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('agents may create tickets', () => {
    renderApp('/tickets/new', makeUser({ role: 'agent' }));
    expect(screen.getByText('page:CreateTicket')).toBeInTheDocument();
  });

  it('sends anonymous users to login', () => {
    renderApp('/tickets', null);
    expect(screen.getByText('page:Login')).toBeInTheDocument();
  });

  it('keeps signed-in users out of login/signup', () => {
    renderApp('/signup', makeUser());
    expect(screen.getByText('page:Dashboard')).toBeInTheDocument();
  });

  it('serves guest and invitation pages without a session', () => {
    renderApp('/signup', null);
    expect(screen.getByText('page:Signup')).toBeInTheDocument();
  });

  it('accept-invite works with or without a session', () => {
    renderApp('/accept-invite', makeUser());
    expect(screen.getByText('page:AcceptInvite')).toBeInTheDocument();
  });

  it('redirects unknown paths to the dashboard', () => {
    renderApp('/does/not/exist', makeUser());
    expect(screen.getByText('page:Dashboard')).toBeInTheDocument();
  });
});
