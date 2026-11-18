import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from './Dashboard';
import TicketList from './TicketList';
import TicketDetails from './TicketDetails';
import CreateTicket from './CreateTicket';
import { useAuth } from '../context/AuthContext';
import ticketService from '../services/ticketService';
import commentService from '../services/commentService';
import memberService from '../services/memberService';
import { renderWithRouter, makeUser, makeTicket } from '../testUtils/renderWithRouter';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../services/ticketService', () => ({
  __esModule: true,
  default: {
    list: jest.fn(), stats: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(),
  },
}));
jest.mock('../services/commentService', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../services/memberService', () => ({ __esModule: true, default: { directory: jest.fn() } }));
jest.mock('../socket/socket', () => require('../testUtils/fakeSocket').mockModule());

const { socket } = require('../socket/socket');

const directory = [
  { id: 10, name: 'Alice Admin', role: 'admin' },
  { id: 20, name: 'Agnes', role: 'agent' },
  { id: 30, name: 'Victor', role: 'viewer' },
];
const page = (items, total = items.length) => ({
  items, pagination: { page: 1, limit: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) },
});
const asUser = (role, id = 10) => useAuth.mockReturnValue({ user: makeUser({ role, id }) });

beforeEach(() => {
  socket.reset();
  memberService.directory.mockResolvedValue(directory);
});

describe('Dashboard', () => {
  const stats = {
    total: 6, open: 2, in_progress: 1, resolved: 1, closed: 1, overdue: 1,
  };

  it('shows organization stats with an overdue highlight and recent tickets', async () => {
    // Arrange
    asUser('admin');
    ticketService.stats.mockResolvedValue(stats);
    ticketService.list.mockResolvedValue(page([makeTicket()]));
    // Act
    renderWithRouter(<Dashboard />);
    // Assert
    const overdue = (await screen.findByText('Overdue')).closest('a');
    expect(overdue).toHaveClass('stat-danger');
    expect(overdue).toHaveAttribute('href', '/tickets?overdue=true');
    expect(screen.getByText('Total tickets').previousSibling).toHaveTextContent('6');
    expect(screen.getByText('VPN down')).toBeInTheDocument();
    expect(ticketService.list).toHaveBeenCalledWith({ page: 1, limit: 5 });
    expect(screen.getByRole('link', { name: '+ New ticket' })).toBeInTheDocument();
  });

  it('hides the create button for viewers and shows errors', async () => {
    asUser('viewer');
    ticketService.stats.mockRejectedValue({ message: 'Cannot reach the server.' });
    ticketService.list.mockResolvedValue(page([]));
    renderWithRouter(<Dashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server.');
    expect(screen.queryByRole('link', { name: '+ New ticket' })).not.toBeInTheDocument();
  });

  it('refreshes (debounced) on live ticket events and after reconnect', async () => {
    jest.useFakeTimers();
    asUser('agent');
    ticketService.stats.mockResolvedValue({ ...stats, overdue: 0 });
    ticketService.list.mockResolvedValue(page([]));
    renderWithRouter(<Dashboard />);
    await act(async () => {});
    expect(ticketService.stats).toHaveBeenCalledTimes(1);
    act(() => {
      socket.trigger('ticket:created', {});
      socket.trigger('ticket:updated', {});
      socket.trigger('ticket:overdue', {});
    });
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(ticketService.stats).toHaveBeenCalledTimes(2);
    await act(async () => { socket.trigger('connect'); socket.trigger('connect'); });
    expect(ticketService.stats).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});

describe('TicketList', () => {
  it('reads filters from the URL and lists tickets', async () => {
    asUser('viewer');
    ticketService.list.mockResolvedValue(page([makeTicket()], 25));
    renderWithRouter(<TicketList />, { route: '/tickets?status=open&page=2', path: '/tickets' });
    expect(await screen.findByText('VPN down')).toBeInTheDocument();
    expect(ticketService.list).toHaveBeenCalledWith({
      status: 'open', priority: '', assigneeId: '', overdue: '', page: 2, limit: 10,
    });
    expect(screen.queryByRole('link', { name: '+ New ticket' })).not.toBeInTheDocument();
  });

  it('writes filter changes and paging back to the URL', async () => {
    // Arrange
    asUser('agent');
    ticketService.list.mockResolvedValue(page([makeTicket()], 25));
    renderWithRouter(<TicketList />, { route: '/tickets', path: '/tickets' });
    await screen.findByText('VPN down');
    // Act
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    // Assert
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets?priority=urgent');
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/tickets?priority=urgent&page=2');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/tickets$/);
    expect(screen.getByRole('link', { name: '+ New ticket' })).toBeInTheDocument();
  });

  it('updates live and survives directory/list errors', async () => {
    jest.useFakeTimers();
    asUser('viewer');
    memberService.directory.mockRejectedValue(new Error('x'));
    ticketService.list.mockRejectedValueOnce({ message: 'Server error' }).mockResolvedValue(page([makeTicket({ title: 'New live ticket' })]));
    renderWithRouter(<TicketList />, { route: '/tickets', path: '/tickets' });
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    act(() => { socket.trigger('ticket:created', { id: 1 }); });
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(screen.getByText('New live ticket')).toBeInTheDocument();
    jest.useRealTimers();
  });
});

describe('CreateTicket', () => {
  it('creates a ticket with staff-only assignee choices and opens it', async () => {
    // Arrange
    asUser('agent', 20);
    ticketService.create.mockResolvedValue({ id: 55 });
    renderWithRouter(<CreateTicket />, { route: '/tickets/new', path: '/tickets/new' });
    await waitFor(() => expect(screen.getAllByRole('option', { name: /Agnes/ })).toHaveLength(1));
    expect(screen.queryByRole('option', { name: /Victor/ })).not.toBeInTheDocument();
    // Act
    await userEvent.type(screen.getByLabelText('Title'), 'Printer');
    await userEvent.type(screen.getByLabelText('Description'), 'Jammed');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    expect(screen.getByText(/SLA-monitored/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Assignee/), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    // Assert
    expect(ticketService.create).toHaveBeenCalledWith({
      title: 'Printer', description: 'Jammed', priority: 'urgent', assigneeId: 20,
    });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/tickets/55'));
  });

  it('sends assigneeId null when unassigned and shows errors', async () => {
    asUser('admin');
    memberService.directory.mockRejectedValue(new Error('x'));
    ticketService.create.mockRejectedValue({ message: 'Validation failed' });
    renderWithRouter(<CreateTicket />, { route: '/tickets/new', path: '/tickets/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'T');
    await userEvent.type(screen.getByLabelText('Description'), 'D');
    expect(screen.queryByText(/SLA-monitored/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    expect(ticketService.create).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: null, priority: 'medium' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation failed');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('cancel goes back', async () => {
    asUser('admin');
    renderWithRouter(<CreateTicket />, { route: '/tickets/new', path: '/tickets/new' });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(memberService.directory).toHaveBeenCalled());
  });
});

describe('TicketDetails', () => {
  const comment = (id, message, at) => ({
    id, ticketId: 100, message, createdAt: at, author: { id: 20, name: 'Agnes', role: 'agent' },
  });
  const renderDetails = () => renderWithRouter(<TicketDetails />, { route: '/tickets/100', path: '/tickets/:id' });

  it('shows ticket fields, SLA and comments', async () => {
    asUser('viewer', 30);
    ticketService.get.mockResolvedValue({ ...makeTicket({ assignee: { id: 20, name: 'Agnes' } }), comments: [comment(1, 'Looking', '2026-01-01T10:01:00Z')] });
    renderDetails();
    expect(await screen.findByRole('heading', { name: /VPN down/ })).toBeInTheDocument();
    expect(ticketService.get).toHaveBeenCalledWith(100);
    expect(screen.getByText('Users cannot connect')).toBeInTheDocument();
    expect(screen.getByText(/Awaiting first staff response/)).toBeInTheDocument();
    expect(screen.getByText('SLA deadline')).toBeInTheDocument();
    expect(screen.getByText('Comments (1)')).toBeInTheDocument();
    // viewer: read-only
    expect(screen.queryByRole('button', { name: 'Edit ticket' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Write a reply/)).not.toBeInTheDocument();
  });

  it('explains when an agent cannot edit another agent ticket', async () => {
    asUser('agent', 21);
    ticketService.get.mockResolvedValue({ ...makeTicket({ assignee: { id: 20, name: 'Agnes' }, sla: { state: 'not_applicable', dueAt: null } }), comments: [] });
    renderDetails();
    expect(await screen.findByText('Only the assignee or an admin can edit this ticket.')).toBeInTheDocument();
    expect(screen.queryByText('SLA deadline')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Write a reply/)).toBeInTheDocument();
  });

  it('marks closed tickets read-only', async () => {
    asUser('admin');
    ticketService.get.mockResolvedValue({ ...makeTicket({ status: 'closed' }), comments: [] });
    renderDetails();
    expect(await screen.findByText(/This ticket is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit ticket' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Write a reply/)).not.toBeInTheDocument();
  });

  it('shows not-found errors with a way back', async () => {
    asUser('admin');
    ticketService.get.mockRejectedValue({ message: 'Ticket not found' });
    renderDetails();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket not found');
    expect(screen.getByRole('link', { name: /Back to tickets/ })).toBeInTheDocument();
  });

  it('edits the ticket (staff-only assignees) and shows a success notice', async () => {
    // Arrange
    asUser('admin');
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [] });
    ticketService.update.mockResolvedValue(makeTicket({ status: 'in_progress' }));
    renderDetails();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit ticket' }));
    await waitFor(() => expect(within(screen.getByLabelText('Assignee')).queryByText(/Victor/)).not.toBeInTheDocument());
    // Act
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    // Assert
    expect(ticketService.update).toHaveBeenCalledWith(100, { status: 'in_progress', version: 3 });
    expect(await screen.findByText('Ticket updated')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Ticket updated')).not.toBeInTheDocument();
  });

  it('reloads the ticket when the save hits a stale version', async () => {
    asUser('admin');
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [] });
    ticketService.update.mockRejectedValue({ errorCode: 'STALE_TICKET', message: 'modified by someone else' });
    memberService.directory.mockRejectedValue(new Error('x'));
    renderDetails();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit ticket' }));
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'urgent');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ticketService.get).toHaveBeenCalledTimes(2));
  });

  it('shows other save errors without reloading, and can cancel editing', async () => {
    asUser('admin');
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [] });
    ticketService.update.mockRejectedValue({ message: 'Invalid status transition' });
    renderDetails();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit ticket' }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'resolved');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Invalid status transition')).toBeInTheDocument();
    expect(ticketService.get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Description' })).toBeInTheDocument();
  });

  it('adds comments without duplicating the matching live event', async () => {
    // Arrange
    asUser('agent', 20);
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [] });
    commentService.create.mockResolvedValue(comment(5, 'On it', '2026-01-01T10:02:00Z'));
    renderDetails();
    // Act
    await userEvent.type(await screen.findByPlaceholderText(/Write a reply/), 'On it');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    act(() => { socket.trigger('comment:created', { ticketId: 100, comment: comment(5, 'On it', '2026-01-01T10:02:00Z') }); });
    // Assert
    expect(commentService.create).toHaveBeenCalledWith(100, 'On it');
    expect(screen.getAllByText('On it')).toHaveLength(1);
  });

  it('merges live comments chronologically and ignores other tickets', async () => {
    asUser('viewer', 30);
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [comment(2, 'second', '2026-01-01T10:02:00Z')] });
    renderDetails();
    await screen.findByText('second');
    act(() => {
      socket.trigger('comment:created', { ticketId: 100, comment: comment(1, 'first', '2026-01-01T10:01:00Z') });
      socket.trigger('comment:created', { ticketId: 100, comment: comment(3, 'third', '2026-01-01T10:02:00Z') });
      socket.trigger('comment:created', { ticketId: 999, comment: comment(9, 'elsewhere', '2026-01-01T10:00:00Z') });
      socket.trigger('comment:created', null);
    });
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.comment-body').textContent)).toEqual(['first', 'second', 'third']);
    expect(screen.queryByText('elsewhere')).not.toBeInTheDocument();
  });

  it('refetches on live updates for THIS ticket only and after reconnect', async () => {
    jest.useFakeTimers();
    asUser('viewer', 30);
    ticketService.get.mockResolvedValue({ ...makeTicket(), comments: [] });
    renderDetails();
    await act(async () => {});
    act(() => {
      socket.trigger('ticket:updated', { id: 999 });
      socket.trigger('ticket:overdue', { id: 999 });
      socket.trigger('ticket:updated', null);
      socket.trigger('ticket:overdue', null);
    });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(ticketService.get).toHaveBeenCalledTimes(1);
    act(() => { socket.trigger('ticket:overdue', { id: 100 }); socket.trigger('ticket:updated', { id: 100 }); });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(ticketService.get).toHaveBeenCalledTimes(2);
    await act(async () => { socket.trigger('connect'); socket.trigger('connect'); });
    expect(ticketService.get).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});
