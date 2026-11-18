import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Layout from './Layout';
import Navbar from './Navbar';
import NotificationBell from './NotificationBell';
import { useAuth } from '../../context/AuthContext';
import notificationService from '../../services/notificationService';
import { renderWithRouter, makeUser } from '../../testUtils/renderWithRouter';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/notificationService', () => ({
  __esModule: true,
  default: { list: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn() },
}));
jest.mock('../../socket/socket', () => require('../../testUtils/fakeSocket').mockModule());

const { socket } = require('../../socket/socket');

const note = (overrides) => ({
  id: 1, ticketId: 100, type: 'sla_overdue', message: 'SLA breached on #100', createdAt: new Date().toISOString(), unread: true, ...overrides,
});

beforeEach(() => {
  socket.reset();
  notificationService.list.mockResolvedValue({ items: [], unreadCount: 0 });
});

describe('Navbar', () => {
  const setup = (role, extra = {}) => {
    const logout = jest.fn().mockResolvedValue();
    useAuth.mockReturnValue({ user: makeUser({ role }), logout, connected: true, ...extra });
    renderWithRouter(<Navbar />, { route: '/tickets' });
    return { logout };
  };

  it.each([
    ['admin', ['Dashboard', 'Tickets', 'New ticket', 'Members', 'Settings']],
    ['agent', ['Dashboard', 'Tickets', 'New ticket']],
    ['viewer', ['Dashboard', 'Tickets']],
  ])('shows role-appropriate links for %s', async (role, links) => {
    setup(role);
    const nav = screen.getByRole('navigation');
    expect([...nav.querySelectorAll('a')].map((a) => a.textContent)).toEqual(links);
    await waitFor(() => expect(notificationService.list).toHaveBeenCalled());
  });

  it('shows user, organization and connection state', async () => {
    setup('agent', { connected: false });
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByTitle(/disconnected/)).toHaveClass('off');
    await waitFor(() => expect(notificationService.list).toHaveBeenCalled());
  });

  it('logs out and returns to /login', async () => {
    const { logout } = setup('viewer');
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(logout).toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });
});

describe('Layout', () => {
  it('renders the navbar and the routed page', async () => {
    useAuth.mockReturnValue({ user: makeUser(), logout: jest.fn(), connected: true });
    renderWithRouter(<Layout />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    await waitFor(() => expect(notificationService.list).toHaveBeenCalled());
  });
});

describe('NotificationBell', () => {
  it('loads unread count and lists notifications', async () => {
    // Arrange
    notificationService.list.mockResolvedValue({ items: [note(), note({ id: 2, type: 'ticket_assigned', unread: false })], unreadCount: 1 });
    renderWithRouter(<NotificationBell />);
    // Act
    const bell = await screen.findByRole('button', { name: 'Notifications (1 unread)' });
    await userEvent.click(bell);
    // Assert
    expect(screen.getByText('SLA')).toBeInTheDocument();
    expect(screen.getByText('Assigned')).toBeInTheDocument();
  });

  it('shows an empty state and caps the badge at 99+', async () => {
    notificationService.list.mockResolvedValue({ items: [], unreadCount: 150 });
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByText('99+')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });

  it('marks a notification read and navigates to its ticket', async () => {
    notificationService.list.mockResolvedValue({ items: [note()], unreadCount: 1 });
    notificationService.markRead.mockResolvedValue({});
    renderWithRouter(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    await userEvent.click(screen.getByText('SLA breached on #100'));
    expect(notificationService.markRead).toHaveBeenCalledWith(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets/100');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications (0 unread)' })).toBeInTheDocument());
  });

  it('does not re-mark already-read notifications', async () => {
    notificationService.list.mockResolvedValue({ items: [note({ unread: false })], unreadCount: 0 });
    renderWithRouter(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    await userEvent.click(screen.getByText('SLA breached on #100'));
    expect(notificationService.markRead).not.toHaveBeenCalled();
  });

  it('marks all read', async () => {
    notificationService.list.mockResolvedValue({ items: [note()], unreadCount: 1 });
    notificationService.markAllRead.mockResolvedValue({});
    renderWithRouter(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(screen.getByRole('button', { name: 'Notifications (0 unread)' })).toBeInTheDocument();
  });

  it('adds live notifications, shows a toast that auto-hides, and de-duplicates', async () => {
    // Arrange
    jest.useFakeTimers();
    renderWithRouter(<NotificationBell />);
    await act(async () => {});
    // Act
    act(() => { socket.trigger('notification:created', note({ id: 7, message: 'Live one' })); });
    // Assert
    expect(screen.getByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
    expect(screen.getByText('SLA breached', { selector: 'strong' })).toBeInTheDocument();
    act(() => { socket.trigger('notification:created', note({ id: 8, type: 'ticket_assigned', message: 'Other' })); });
    expect(screen.getByText('Notification', { selector: 'strong' })).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(6000); });
    expect(screen.queryByText('Notification', { selector: 'strong' })).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it('refetches after a socket reconnect and closes on outside click', async () => {
    notificationService.list.mockResolvedValue({ items: [note()], unreadCount: 1 });
    renderWithRouter(<NotificationBell />);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('Notifications', { selector: 'strong' })).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByText('Notifications', { selector: 'strong' })).not.toBeInTheDocument();

    act(() => { socket.trigger('connect'); socket.trigger('connect'); });
    await waitFor(() => expect(notificationService.list).toHaveBeenCalledTimes(2));
  });

  it('keeps working when loading fails', async () => {
    notificationService.list.mockRejectedValue(new Error('down'));
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications (0 unread)' })).toBeInTheDocument();
  });
});
