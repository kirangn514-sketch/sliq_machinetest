import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Members from './Members';
import Settings from './Settings';
import { useAuth } from '../context/AuthContext';
import memberService from '../services/memberService';
import settingsService from '../services/settingsService';
import { renderWithRouter, makeUser } from '../testUtils/renderWithRouter';

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../services/memberService', () => ({
  __esModule: true,
  default: {
    list: jest.fn(), invite: jest.fn(), changeRole: jest.fn(), remove: jest.fn(), revokeInvitation: jest.fn(),
  },
}));
jest.mock('../services/settingsService', () => ({ __esModule: true, default: { getSla: jest.fn(), updateSla: jest.fn() } }));
jest.mock('../socket/socket', () => require('../testUtils/fakeSocket').mockModule());

const { socket } = require('../socket/socket');

const data = {
  members: [
    { id: 10, name: 'Alice Admin', email: 'a@x.io', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
    { id: 20, name: 'Bob', email: 'b@x.io', role: 'agent', createdAt: '2026-01-01T00:00:00Z' },
  ],
  invitations: [{
    id: 7, name: 'Carol', email: 'c@x.io', role: 'viewer', expiresAt: '2026-02-01T00:00:00Z',
  }],
};

beforeEach(() => {
  socket.reset();
  useAuth.mockReturnValue({ user: makeUser() });
  memberService.list.mockResolvedValue(data);
});

describe('Members page', () => {
  const rowOf = async (name) => (await screen.findByText(name)).closest('tr');

  it('lists members, pending invitations and role help', async () => {
    renderWithRouter(<Members />);
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('changes a role and reloads', async () => {
    memberService.changeRole.mockResolvedValue({});
    renderWithRouter(<Members />);
    await userEvent.selectOptions(within(await rowOf('Bob')).getByRole('combobox'), 'viewer');
    expect(memberService.changeRole).toHaveBeenCalledWith(20, 'viewer');
    expect(await screen.findByText('Bob is now viewer.')).toBeInTheDocument();
    expect(memberService.list).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('shows backend refusals such as LAST_ADMIN', async () => {
    memberService.changeRole.mockRejectedValue({ message: 'The organization must keep at least one admin' });
    renderWithRouter(<Members />);
    await userEvent.selectOptions(within(await rowOf('Alice Admin')).getByRole('combobox'), 'agent');
    expect(await screen.findByRole('alert')).toHaveTextContent('at least one admin');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('removes a member only after confirmation, warning when removing yourself', async () => {
    // Arrange
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    memberService.remove.mockResolvedValue({});
    renderWithRouter(<Members />);
    // Act
    await userEvent.click(within(await rowOf('Alice Admin')).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await rowOf('Bob')).getByRole('button', { name: 'Remove' }));
    // Assert
    expect(confirm.mock.calls[0][0]).toMatch(/You will be signed out/);
    expect(confirm.mock.calls[1][0]).not.toMatch(/You will be signed out/);
    expect(memberService.remove).toHaveBeenCalledTimes(1);
    expect(memberService.remove).toHaveBeenCalledWith(20);
    expect(await screen.findByText('Bob was removed.')).toBeInTheDocument();
  });

  it('revokes invitations', async () => {
    memberService.revokeInvitation.mockResolvedValue({});
    renderWithRouter(<Members />);
    await userEvent.click(within(await rowOf('Carol')).getByRole('button', { name: 'Revoke' }));
    expect(memberService.revokeInvitation).toHaveBeenCalledWith(7);
    expect(await screen.findByText('Invitation revoked.')).toBeInTheDocument();
  });

  it('invites a member and reloads the list', async () => {
    memberService.invite.mockResolvedValue({ invitation: { email: 'd@x.io' } });
    renderWithRouter(<Members />);
    await screen.findByText('Bob');
    await userEvent.type(screen.getByLabelText('Name'), 'Dan');
    await userEvent.type(screen.getByLabelText('Email'), 'd@x.io');
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(memberService.invite).toHaveBeenCalledWith({ name: 'Dan', email: 'd@x.io', role: 'agent' });
    await waitFor(() => expect(memberService.list).toHaveBeenCalledTimes(2));
  });

  it('hides the invitations table when none are pending, and reloads on members:changed', async () => {
    memberService.list.mockResolvedValue({ ...data, invitations: [] });
    renderWithRouter(<Members />);
    await screen.findByText('Bob');
    expect(screen.queryByRole('heading', { name: 'Pending invitations' })).not.toBeInTheDocument();
    await act(async () => { socket.trigger('members:changed', {}); });
    expect(memberService.list).toHaveBeenCalledTimes(2);
  });

  it('shows load errors', async () => {
    memberService.list.mockRejectedValue({ message: 'You do not have permission' });
    renderWithRouter(<Members />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
  });
});

describe('Settings page', () => {
  it('loads and saves the SLA response time', async () => {
    // Arrange
    settingsService.getSla.mockResolvedValue({ responseTimeMinutes: 5, updatedAt: '2026-01-01T00:00:00Z' });
    settingsService.updateSla.mockResolvedValue({ responseTimeMinutes: 15, updatedAt: '2026-01-02T00:00:00Z' });
    renderWithRouter(<Settings />);
    const input = await screen.findByLabelText(/Response time/);
    // Act
    expect(input).toHaveValue(5);
    await userEvent.clear(input);
    await userEvent.type(input, '15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Assert
    expect(settingsService.updateSla).toHaveBeenCalledWith(15);
    expect(await screen.findByText(/applies to SLA timers started from now on/)).toBeInTheDocument();
    expect(screen.getByText(/Last changed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('shows validation errors from the API', async () => {
    settingsService.getSla.mockResolvedValue({ responseTimeMinutes: 5, updatedAt: null });
    settingsService.updateSla.mockRejectedValue({ message: 'Validation failed', fields: { responseTimeMinutes: 'must be between 1 and 43200' } });
    renderWithRouter(<Settings />);
    await screen.findByLabelText(/Response time/);
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('must be between 1 and 43200')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('shows load errors', async () => {
    settingsService.getSla.mockRejectedValue({ message: 'Forbidden' });
    renderWithRouter(<Settings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });
});
